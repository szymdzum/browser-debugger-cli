/**
 * A CLI bundle that fails to load is reported, not dumped as a stack.
 *
 * The entry (dist/index.js) loads the CLI (dist/cli.js) after it installs
 * the interrupt report. When that load fails (the file missing, or throwing
 * as it loads, as after a partial install), bdg exits 110 with one `--json`
 * envelope or one stderr line naming the file and suggesting a reinstall;
 * the stack only with `--debug`. Runs a copy of the entry in a throwaway
 * package directory, so the real dist is untouched.
 */

import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/** Built entry of the real package */
const ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/index.js');

/** SOFTWARE_ERROR */
const EXIT_CODE = 110;

/**
 * A throwaway package with the real entry and the given CLI bundle.
 *
 * @param cli - Content of dist/cli.js, or undefined for none
 * @returns Path of its dist/index.js
 */
function packageWithCli(cli: string | undefined): string {
  const root = makeTempDir('bdg-cli-load-');
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"bdg-test","version":"0.0.0-test","type":"module"}'
  );
  fs.copyFileSync(ENTRY, path.join(root, 'dist', 'index.js'));
  if (cli !== undefined) fs.writeFileSync(path.join(root, 'dist', 'cli.js'), cli);
  return path.join(root, 'dist', 'index.js');
}

/**
 * Run the entry.
 *
 * @param entry - Path of dist/index.js
 * @param args - bdg arguments
 * @returns Exit code and output
 */
function run(
  entry: string,
  args: string[]
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BDG_DEBUG: '' },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

after(removeTempDirs);

const BUNDLES = [
  { name: 'missing', cli: undefined },
  { name: 'throwing as it loads', cli: "throw new Error('broken bundle');\n" },
];

void describe('A CLI bundle that fails to load', () => {
  for (const { name, cli } of BUNDLES) {
    void it(`${name}: one envelope with --json, exit ${EXIT_CODE}`, () => {
      const entry = packageWithCli(cli);
      const result = run(entry, ['status', '--json']);
      const shown = JSON.stringify(result);
      assert.equal(result.code, EXIT_CODE, shown);
      const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
      assert.equal(lines.length, 1, shown);
      const envelope = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
      assert.equal(envelope['success'], false, shown);
      assert.equal(envelope['exitCode'], EXIT_CODE, shown);
      assert.ok(
        String(envelope['error']).includes(path.join(path.dirname(entry), 'cli.js')),
        shown
      );
      assert.match(String(envelope['suggestion']), /Reinstall/, shown);
      assert.equal(result.stderr, '', shown);
    });

    void it(`${name}: one stderr line without --json, the stack only with --debug`, () => {
      const entry = packageWithCli(cli);
      const plain = run(entry, ['status']);
      const shown = JSON.stringify(plain);
      assert.equal(plain.code, EXIT_CODE, shown);
      assert.equal(plain.stdout, '', shown);
      const lines = plain.stderr.split('\n').filter((line) => line.trim() !== '');
      assert.equal(lines.length, 1, shown);
      assert.match(
        lines[0] ?? '',
        /^Error: The bdg CLI failed to load \(.*cli\.js\)\. Reinstall/,
        shown
      );
      const debug = run(entry, ['status', '--debug']);
      assert.equal(debug.code, EXIT_CODE, JSON.stringify(debug));
      assert.match(debug.stderr, /\n\s+at /, JSON.stringify(debug));
    });
  }
});
