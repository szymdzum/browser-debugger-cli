/**
 * State files on disk (#454): a new file is readable by its owner only, an
 * existing file keeps its mode, a symlink at the path is replaced (its
 * destination untouched), and a missing or unreadable file exits 81.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import {
  STATE_FILE_MAX_BYTES,
  readStateFile,
  writeStateFile,
} from '@/commands/shared/stateFile.js';
import { CommandError } from '@/errors/index.js';
import type { AuthStateContent } from '@/ipc/protocol/stateTypes.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

after(removeTempDirs);

/** A state with one cookie and one origin */
const STATE: AuthStateContent = {
  cookies: [{ name: 'sid', value: 'v', domain: 'a.example', path: '/', session: true }],
  origins: [{ origin: 'https://a.example', localStorage: { k: 'v' }, sessionStorage: {} }],
};

/**
 * Assert that reading fails with exit 81 and a suggestion.
 *
 * @param file - Path
 * @param reason - Pattern the message must match
 */
function assertUnreadable(file: string, reason: RegExp): void {
  assert.throws(
    () => readStateFile(file),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
      assert.match(error.message, reason);
      assert.ok(error.metadata.suggestion);
      return true;
    }
  );
}

void describe('state files', { skip: process.platform === 'win32' }, () => {
  it('creates a new file 0600 that reads back', async () => {
    const file = path.join(makeTempDir('bdg-state-'), 'nested', 's.json');
    const written = await writeStateFile(file, STATE);
    assert.equal(written, file);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readStateFile(file), STATE);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['s.json'], 'no temp file left');
  });

  it('keeps the mode of an existing file', async () => {
    const file = path.join(makeTempDir('bdg-state-'), 's.json');
    fs.writeFileSync(file, 'old');
    fs.chmodSync(file, 0o640);
    await writeStateFile(file, STATE);
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
    assert.deepEqual(readStateFile(file), STATE);
  });

  it('replaces a symlink instead of writing through it', async () => {
    const dir = makeTempDir('bdg-state-');
    const victim = path.join(dir, 'victim.txt');
    fs.writeFileSync(victim, 'untouched');
    const file = path.join(dir, 's.json');
    fs.symlinkSync(victim, file);
    await writeStateFile(file, STATE);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
    assert.ok(fs.lstatSync(file).isFile());
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it('refuses a directory as the file (81)', async () => {
    const dir = makeTempDir('bdg-state-');
    await assert.rejects(writeStateFile(dir, STATE), (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
      return true;
    });
  });

  it('exits 81 for a missing file, a directory and bad JSON', () => {
    const dir = makeTempDir('bdg-state-');
    assertUnreadable(path.join(dir, 'missing.json'), /does not exist/);
    assertUnreadable(dir, /is a directory/);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{');
    assertUnreadable(bad, /not valid JSON/);
  });

  it('exits 81 for a FIFO without blocking on it', () => {
    const fifo = path.join(makeTempDir('bdg-state-'), 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    assertUnreadable(fifo, /not a regular file/);
  });

  it('exits 81 for a file over the size limit', () => {
    const big = path.join(makeTempDir('bdg-state-'), 'big.json');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, STATE_FILE_MAX_BYTES + 1);
    assertUnreadable(big, /larger than 50 MB/);
  });
});
