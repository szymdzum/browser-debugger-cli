/**
 * Node's module compile cache speeds up every bdg start (#661).
 *
 * The built entry (dist/index.js) enables the cache: Node keeps it in
 * `<TMPDIR>/node-compile-cache`. `NODE_DISABLE_COMPILE_CACHE=1` turns it off,
 * and a cache directory that cannot be written changes nothing the user sees.
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

/** Name of the directory Node creates in `TMPDIR` */
const CACHE_DIR_NAME = 'node-compile-cache';

/**
 * Count the files below a directory.
 *
 * @param dir - Directory to walk
 * @returns Number of files
 */
function countFiles(dir: string): number {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .reduce(
      (sum, entry) => sum + (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1),
      0
    );
}

/**
 * Run `bdg --version` with the given temp dir and compile cache settings.
 *
 * @param tmpdir - Value of `TMPDIR`
 * @param disable - Whether to set `NODE_DISABLE_COMPILE_CACHE=1`
 * @param cacheDir - Value of `NODE_COMPILE_CACHE`, if any
 * @returns Exit code and output
 */
function runVersion(
  tmpdir: string,
  disable: boolean,
  cacheDir?: string
): { code: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmpdir };
  delete env['NODE_COMPILE_CACHE'];
  delete env['NODE_DISABLE_COMPILE_CACHE'];
  if (cacheDir !== undefined) env['NODE_COMPILE_CACHE'] = cacheDir;
  if (disable) env['NODE_DISABLE_COMPILE_CACHE'] = '1';
  const result = spawnSync(process.execPath, [ENTRY, '--version'], { encoding: 'utf8', env });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

after(removeTempDirs);

void describe('Node compile cache', () => {
  void it('is created in TMPDIR by a normal run', () => {
    const tmp = makeTempDir('bdg-cc-');
    const result = runVersion(tmp, false);
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.ok(fs.existsSync(path.join(tmp, CACHE_DIR_NAME)), fs.readdirSync(tmp).join(','));
    assert.ok(countFiles(path.join(tmp, CACHE_DIR_NAME)) > 0, 'cache dir holds no file');
  });

  void it('goes to NODE_COMPILE_CACHE when it is set', () => {
    const tmp = makeTempDir('bdg-cc-');
    const custom = path.join(makeTempDir('bdg-cc-custom-'), 'cache');
    const result = runVersion(tmp, false, custom);
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.ok(countFiles(custom) > 0, 'custom cache dir holds no file');
    assert.equal(fs.existsSync(path.join(tmp, CACHE_DIR_NAME)), false);
  });

  void it('is not created with NODE_DISABLE_COMPILE_CACHE=1', () => {
    const tmp = makeTempDir('bdg-cc-');
    const result = runVersion(tmp, true);
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(tmp, CACHE_DIR_NAME)), false);
  });

  void it('leaves output and exit code unchanged when the cache directory is not writable', (t) => {
    if (process.getuid?.() === 0) {
      t.skip('root ignores directory permissions');
      return;
    }
    const readOnly = makeTempDir('bdg-cc-ro-');
    fs.chmodSync(readOnly, 0o555);
    const withCache = runVersion(readOnly, false);
    const without = runVersion(readOnly, true);
    assert.equal(withCache.code, 0, JSON.stringify(withCache));
    assert.deepEqual(withCache, without);
    assert.equal(fs.existsSync(path.join(readOnly, CACHE_DIR_NAME)), false);
  });
});
