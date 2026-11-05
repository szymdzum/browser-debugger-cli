/**
 * Output files: written atomically into new directories, and path problems
 * reported as the user's errors with the path named.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

  void it(
    'writes through a symlink to a regular file, keeping the link (#895)',
    { skip: process.platform === 'win32' },
    async () => {
      const sub = fs.mkdtempSync(path.join(dir, 'link-'));
      const real = path.join(sub, 'real.png');
      fs.writeFileSync(real, 'ORIGINAL');
      const link = path.join(sub, 'link.png');
      fs.symlinkSync(real, link);
      assert.equal(await writeOutputFile(link, Buffer.from('new')), link);
      assert.ok(fs.lstatSync(link).isSymbolicLink());
      assert.equal(fs.readFileSync(real, 'utf8'), 'new');
      assert.deepEqual(fs.readdirSync(sub).sort(), ['link.png', 'real.png']);
    }
  );

  for (const [kind, reason, make] of [
    ['a FIFO', /not a regular file/, (file: string) => execFileSync('mkfifo', [file])],
    [
      'a symlink to a device',
      /not a regular file/,
      (file: string) => fs.symlinkSync('/dev/null', file),
    ],
    [
      'a dangling symlink',
      /symlink to a missing file/,
      (file: string) => fs.symlinkSync(`${file}.missing`, file),
    ],
  ] as const) {
    void it(
      `refuses ${kind} and leaves it in place (81, #895)`,
      { skip: process.platform === 'win32' },
      async () => {
        const sub = fs.mkdtempSync(path.join(dir, 'special-'));
        const file = path.join(sub, 'out.png');
        make(file);
        const before = fs.lstatSync(file);
        await assertCommandError(
          () => writeOutputFile(file, Buffer.from('x')),
          EXIT_CODES.INVALID_ARGUMENTS,
          reason
        );
        assert.equal(fs.lstatSync(file).ino, before.ino);
        assert.deepEqual(fs.readdirSync(sub), ['out.png'], 'no temp file left');
      }
    );
  }
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
