/**
 * Session directory trust (#438): directories are created 0700, untrusted
 * ones (a symlink, another user's, writable by group or others) are refused
 * before starting a daemon or connecting to one, and the user's own
 * directories that are merely readable by others are tightened.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { SessionDirError } from '@/daemon/errors.js';
import { assertUsableSessionDir, openDaemonLog } from '@/daemon/launcher.js';
import { CommandError } from '@/errors/index.js';
import {
  sessionDirIsFileError,
  sessionDirNotWritableError,
  sessionNameSocketTooLongError,
  socketPathTooLongError,
  untrustedSessionDirError,
} from '@/errors/messages.js';
import { sendRequest } from '@/ipc/transport/index.js';
import { ensureSessionDir, getSessionDir, secureSessionDir } from '@/session/paths.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const POSIX = process.platform !== 'win32';
const savedEnv = { dir: process.env['BDG_SESSION_DIR'], name: process.env['BDG_SESSION'] };
let root: string;

/**
 * Restore an environment variable.
 *
 * @param key - Variable name
 * @param value - Saved value
 */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Permission bits of a path (not following a symlink).
 *
 * @param p - Path
 * @returns Mode & 0o777
 */
function modeOf(p: string): number {
  return fs.lstatSync(p).mode & 0o777;
}

/**
 * Run assertUsableSessionDir and return what it threw.
 *
 * @returns The SessionDirError, or undefined
 */
function checkUsable(): SessionDirError | undefined {
  try {
    assertUsableSessionDir();
    return undefined;
  } catch (error) {
    assert.ok(error instanceof SessionDirError);
    return error;
  }
}

void describe('session directory trust', { skip: !POSIX }, () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-trust-'));
    process.env['BDG_SESSION_DIR'] = path.join(root, 'base');
    delete process.env['BDG_SESSION'];
  });

  afterEach(() => {
    restoreEnv('BDG_SESSION_DIR', savedEnv.dir);
    restoreEnv('BDG_SESSION', savedEnv.name);
    fs.rmSync(root, { recursive: true, force: true });
  });

  void it('creates the base, sessions/ and a named session directory 0700', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    ensureSessionDir();
    const base = path.join(root, 'base');
    assert.equal(modeOf(base), 0o700);
    assert.equal(modeOf(path.join(base, 'sessions')), 0o700);
    assert.equal(modeOf(getSessionDir()), 0o700);
  });

  void it('refuses a group/other-writable session directory with the mode and a suggestion', () => {
    fs.mkdirSync(getSessionDir(), { mode: 0o700 });
    fs.chmodSync(getSessionDir(), 0o777);
    const error = checkUsable();
    assert.equal(error?.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
    assert.match(error?.message ?? '', /writable by others \(mode 777\)/);
    assert.match(error?.suggestion ?? '', /BDG_SESSION_DIR/);
    fs.chmodSync(getSessionDir(), 0o720);
    assert.match(checkUsable()?.message ?? '', /writable by others \(mode 720\)/);
  });

  void it('refuses a session directory that is a symlink', () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, getSessionDir());
    const error = checkUsable();
    assert.equal(error?.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
    assert.match(error?.message ?? '', /symbolic link/);
  });

  void it('refuses a session directory owned by another user', (t) => {
    fs.mkdirSync(getSessionDir(), { mode: 0o700 });
    const ownerUid = fs.statSync(getSessionDir()).uid;
    t.mock.method(process as { getuid: () => number }, 'getuid', () => ownerUid + 1);
    const error = checkUsable();
    assert.equal(error?.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
    assert.match(error?.message ?? '', new RegExp(`owned by uid ${ownerUid}`));
  });

  void it('refuses a named session whose base or sessions/ directory is writable by others', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    const base = path.join(root, 'base');
    fs.mkdirSync(path.join(base, 'sessions'), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(base, 'sessions'), 0o777);
    const error = checkUsable();
    assert.match(error?.message ?? '', /sessions.*writable by others/);
    assert.equal(fs.existsSync(getSessionDir()), false);
  });

  void it("tightens the user's own directory that others can only read (0755 → 0700)", () => {
    process.env['BDG_SESSION'] = 'agent-1';
    const base = path.join(root, 'base');
    fs.mkdirSync(getSessionDir(), { recursive: true, mode: 0o755 });
    fs.chmodSync(base, 0o755);
    fs.chmodSync(getSessionDir(), 0o755);
    assert.equal(checkUsable(), undefined);
    assert.equal(modeOf(base), 0o700);
    assert.equal(modeOf(getSessionDir()), 0o700);
  });

  void it('does not refuse a missing directory (it is created later)', () => {
    assert.equal(secureSessionDir(), null);
  });

  void it('refuses to connect to a socket in an untrusted directory, without connecting', async () => {
    fs.mkdirSync(getSessionDir(), { mode: 0o700 });
    fs.chmodSync(getSessionDir(), 0o777);
    await assert.rejects(
      sendRequest({ type: 'status_request', sessionId: 'x' }, 'status'),
      (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
        assert.match(error.message, /writable by others/);
        assert.equal(typeof error.metadata['suggestion'], 'string');
        return true;
      }
    );
  });

  void it('creates daemon.log 0600', () => {
    ensureSessionDir();
    const logPath = path.join(getSessionDir(), 'daemon.log');
    fs.closeSync(openDaemonLog(logPath));
    assert.equal(modeOf(logPath), 0o600);
  });

  void it('refuses a symlinked daemon.log instead of appending to its target', () => {
    ensureSessionDir();
    const victim = path.join(root, 'victim.txt');
    fs.writeFileSync(victim, 'ORIGINAL\n');
    const logPath = path.join(getSessionDir(), 'daemon.log');
    fs.symlinkSync(victim, logPath);
    assert.throws(
      () => openDaemonLog(logPath),
      (error: unknown) => {
        assert.ok(error instanceof SessionDirError);
        assert.equal(error.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
        assert.match(error.message, /symbolic link/);
        return true;
      }
    );
    assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL\n');
  });
});

void describe('session directory suggestions', () => {
  void it('never suggest the shared /tmp/bdg', () => {
    const suggestions = [
      sessionDirIsFileError('/x').suggestion,
      sessionDirNotWritableError('/x', 'EACCES').suggestion,
      socketPathTooLongError('/x/daemon.sock', 95).suggestion,
      sessionNameSocketTooLongError('n', '/x/daemon.sock', 95).suggestion,
      untrustedSessionDirError('/x', 'writable by others (mode 777)').suggestion,
    ];
    for (const suggestion of suggestions) {
      assert.doesNotMatch(suggestion, /\/tmp\/bdg(?![-\w])/);
    }
  });
});
