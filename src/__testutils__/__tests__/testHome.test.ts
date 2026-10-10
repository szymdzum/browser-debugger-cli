/**
 * Test session directories: with `BDG_TEST_SESSION_PARENT`, each test process
 * gets its own directory under that parent, removed when the process exits.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

const execFileAsync = promisify(execFile);

const testHomeModule = pathToFileURL(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'testHome.ts')
).href;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Run a Node process that sets up its test session directory and exits.
 *
 * @param parent - Value of `BDG_TEST_SESSION_PARENT`
 * @returns The session directory the process printed
 */
async function sessionDirOfChild(parent: string): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, BDG_TEST_SESSION_PARENT: parent };
  delete env['BDG_TEST_SESSION_DIR'];
  delete env['BDG_TEST_KEEP_DIRS'];
  const code = `import { ensureTestSessionDir } from ${JSON.stringify(testHomeModule)};
console.log(ensureTestSessionDir());`;
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: repoRoot, env, timeout: 30000 }
  );
  return stdout.trim();
}

void describe('ensureTestSessionDir with BDG_TEST_SESSION_PARENT', () => {
  after(removeTempDirs);

  it('gives each process its own directory under the parent and removes it on exit', async () => {
    const parent = path.join(makeTempDir('bdg-parent-'), 'nested');

    const [first, second] = await Promise.all([
      sessionDirOfChild(parent),
      sessionDirOfChild(parent),
    ]);

    assert.notEqual(first, second);
    for (const dir of [first, second]) {
      assert.equal(path.dirname(dir), parent);
      assert.match(path.basename(dir), /^bdg-test-/);
      assert.equal(fs.existsSync(dir), false, `${dir} was not removed on exit`);
    }
  });
});
