/**
 * Unit tests for daemon launcher
 *
 * Note: These are simplified tests that verify the core error handling logic.
 * The launchDaemon function throws appropriate errors that can be caught by callers.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { SessionDirError } from '@/daemon/errors.js';
import { assertUsableSessionDir } from '@/daemon/launcher.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('daemon/launcher error handling', () => {
  void it('should have DAEMON_ALREADY_RUNNING exit code defined', () => {
    assert.equal(EXIT_CODES.DAEMON_ALREADY_RUNNING, 86);
  });

  void it('should use user error range for DAEMON_ALREADY_RUNNING', () => {
    // User errors are in range 80-99
    assert.ok(EXIT_CODES.DAEMON_ALREADY_RUNNING >= 80);
    assert.ok(EXIT_CODES.DAEMON_ALREADY_RUNNING <= 99);
  });
});

void describe('assertUsableSessionDir', () => {
  /**
   * Run the check with BDG_SESSION_DIR set to `dir`.
   *
   * @param dir - Session directory
   * @returns The error thrown, if any
   */
  function checkDir(dir: string): SessionDirError | undefined {
    const saved = process.env['BDG_SESSION_DIR'];
    process.env['BDG_SESSION_DIR'] = dir;
    try {
      assertUsableSessionDir();
      return undefined;
    } catch (error) {
      assert.ok(error instanceof SessionDirError);
      return error;
    } finally {
      if (saved === undefined) delete process.env['BDG_SESSION_DIR'];
      else process.env['BDG_SESSION_DIR'] = saved;
    }
  }

  void it('accepts a writable directory (creating it)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-dir-'));
    assert.equal(checkDir(path.join(base, 's')), undefined);
    fs.rmSync(base, { recursive: true, force: true });
  });

  void it('rejects a file (103) and a path too long for the socket (81, like named sessions)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-dir-'));
    const file = path.join(base, 'file');
    fs.writeFileSync(file, '');
    assert.equal(checkDir(file)?.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
    const long = checkDir(path.join(base, 'x'.repeat(120)));
    assert.equal(long?.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(long?.message ?? '', /Session directory path is too long/);
    fs.rmSync(base, { recursive: true, force: true });
  });
});
