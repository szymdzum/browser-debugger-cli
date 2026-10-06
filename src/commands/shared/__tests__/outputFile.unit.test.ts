/**
 * Output files: written atomically into new directories, and path problems
 * reported as the user's errors with the path named.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { assertFilePath, outputPathError, writeOutputFile } from '@/commands/shared/outputFile.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-output-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Assert that a call throws a CommandError with the given exit code.
 *
 * @param fn - Call expected to throw
 * @param exitCode - Expected exit code
 * @param message - Pattern the message must match
 */
async function assertCommandError(
  fn: () => unknown,
  exitCode: number,
  message: RegExp
): Promise<void> {
  await assert.rejects(
    async () => {
      await fn();
    },
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, exitCode);
      assert.match(error.message, message);
      return true;
    }
  );
}

void describe('writeOutputFile', () => {
  void it('creates missing directories and returns the absolute path', async () => {
    const target = path.join(dir, 'a', 'b', 'out.har');
    const written = await writeOutputFile(path.relative(process.cwd(), target), '{}');
    assert.equal(written, target);
    assert.equal(fs.readFileSync(target, 'utf8'), '{}');
  });

  void it('rejects a directory as the target (81)', async () => {
    await assertCommandError(
      () => writeOutputFile(dir, 'x'),
      EXIT_CODES.INVALID_ARGUMENTS,
      /it is a directory/
    );
  });

  void it('rejects a path below a file (81)', async () => {
    const file = path.join(dir, 'plain');
    fs.writeFileSync(file, '');
    await assertCommandError(
      () => writeOutputFile(path.join(file, 'out.png'), Buffer.from('x')),
      EXIT_CODES.INVALID_ARGUMENTS,
      /a part of the path is a file/
    );
  });
});

void describe('assertFilePath', () => {
  void it('rejects an empty path (81)', async () => {
    await assertCommandError(
      () => assertFilePath('  '),
      EXIT_CODES.INVALID_ARGUMENTS,
      /path is empty/
    );
  });
});

void describe('outputPathError', () => {
  void it('maps permission problems to 82 and suggests a file of the same type', () => {
    const error = outputPathError(
      '/etc/out.har',
      Object.assign(new Error('x'), { code: 'EACCES' })
    );
    assert.equal(error.exitCode, EXIT_CODES.PERMISSION_DENIED);
    assert.equal(error.message, 'Cannot write /etc/out.har: permission denied');
    assert.match(String(error.metadata.suggestion), /output\.har/);
  });

  void it('refuses a path on a pseudo-filesystem at once (81) instead of creating it', async () => {
    const error = await writeOutputFile('/proc/bdg-x/shot.png', 'x', 'png').catch(
      (thrown: unknown) => thrown
    );
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(error.message, /it is on a pseudo-filesystem/);
  });
});
