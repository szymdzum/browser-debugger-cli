/**
 * Session directory trust (#438): directories are created 0700, untrusted
 * ones (a symlink, another user's, writable by group or others) are refused
 * before starting a daemon or connecting to one, and the user's own
 * directories that are merely readable by others are tightened.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
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
import { listRunningSessions } from '@/session/sessionList.js';
import { formatSessionList } from '@/ui/formatters/sessions.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const POSIX = process.platform !== 'win32';
const savedEnv = {
  dir: process.env['BDG_SESSION_DIR'],
  name: process.env['BDG_SESSION'],
  home: process.env['HOME'],
};
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
    restoreEnv('HOME', savedEnv.home);
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

  void it('refuses an other-writable session directory with exit 103, the mode and a suggestion', () => {
    fs.mkdirSync(getSessionDir(), { mode: 0o700 });
    fs.chmodSync(getSessionDir(), 0o777);
    const error = checkUsable();
    assert.equal(error?.exitCode, 103);
    assert.match(error?.message ?? '', /writable by others \(mode 777\)/);
    assert.match(error?.suggestion ?? '', /^Use a directory you own .*BDG_SESSION_DIR=/);
    fs.chmodSync(getSessionDir(), 0o722);
    assert.match(checkUsable()?.message ?? '', /writable by others \(mode 722\)/);
  });

  void it('refuses a shared sticky directory (1777) and suggests a subdirectory', () => {
    fs.mkdirSync(getSessionDir(), { mode: 0o700 });
    fs.chmodSync(getSessionDir(), 0o1777);
    const error = checkUsable();
    assert.equal(error?.exitCode, 103);
    assert.match(error?.message ?? '', /shared sticky directory \(mode 1777\)/);
    assert.match(error?.suggestion ?? '', /subdirectory/);
  });

  void it('accepts own group-writable directories made under umask 002, tightening only bdg-owned ones', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    const base = path.join(root, 'base');
    const previous = process.umask(0o002);
    try {
      fs.mkdirSync(getSessionDir(), { recursive: true });
    } finally {
      process.umask(previous);
    }
    assert.equal(modeOf(base), 0o775);
    assert.equal(modeOf(path.join(base, 'sessions')), 0o775);
    assert.equal(checkUsable(), undefined);
    assert.equal(modeOf(base), 0o775, 'a user-supplied BDG_SESSION_DIR is never chmod-ed');
    assert.equal(modeOf(path.join(base, 'sessions')), 0o700);
    assert.equal(modeOf(getSessionDir()), 0o700);
  });

  void it('tightens the default ~/.bdg made 0775 by an older bdg under umask 002', () => {
    delete process.env['BDG_SESSION_DIR'];
    process.env['HOME'] = root;
    const bdgDir = path.join(root, '.bdg');
    fs.mkdirSync(bdgDir);
    fs.chmodSync(bdgDir, 0o775);
    assert.equal(getSessionDir(), bdgDir);
    assert.equal(checkUsable(), undefined);
    assert.equal(modeOf(bdgDir), 0o700);
  });

  void it('accepts a base directory that is a symlink to a trusted directory, without chmod', () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.chmodSync(real, 0o755);
    fs.symlinkSync(real, getSessionDir());
    assert.equal(checkUsable(), undefined);
    assert.equal(modeOf(real), 0o755);
  });

  void it('accepts a symlinked default ~/.bdg (dotfiles) whose target is trusted', () => {
    delete process.env['BDG_SESSION_DIR'];
    process.env['HOME'] = root;
    const real = path.join(root, 'dotfiles-bdg');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, path.join(root, '.bdg'));
    assert.equal(checkUsable(), undefined);
  });

  void it('refuses a symlinked base whose target is writable by others', () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.chmodSync(real, 0o777);
    fs.symlinkSync(real, getSessionDir());
    const error = checkUsable();
    assert.equal(error?.exitCode, 103);
    assert.match(error?.message ?? '', /links to .*real, which is writable by others \(mode 777\)/);
  });

  void it('refuses a symlinked sessions/ or named session directory, suggesting to remove the link', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    const base = path.join(root, 'base');
    const real = path.join(root, 'real');
    fs.mkdirSync(path.join(base, 'sessions'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, getSessionDir());
    const named = checkUsable();
    assert.equal(named?.exitCode, 103);
    assert.match(named?.message ?? '', /agent-1 is not safe to use: it is a symbolic link/);
    assert.match(
      named?.suggestion ?? '',
      /^Remove the link .*agent-1.* or point BDG_SESSION_DIR at the real directory/
    );
    fs.rmSync(path.join(base, 'sessions'), { recursive: true });
    fs.symlinkSync(real, path.join(base, 'sessions'));
    assert.match(
      checkUsable()?.message ?? '',
      /sessions is not safe to use: it is a symbolic link/
    );
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
    assert.match(
      error?.suggestion ?? '',
      /^Run chmod 700 .*sessions \(or remove it if it is not yours\)/
    );
    assert.equal(fs.existsSync(getSessionDir()), false);
  });

  void it('tightens named session directories (0755 → 0700) but not a user-supplied base', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    const base = path.join(root, 'base');
    fs.mkdirSync(getSessionDir(), { recursive: true, mode: 0o755 });
    fs.chmodSync(base, 0o755);
    fs.chmodSync(path.join(base, 'sessions'), 0o755);
    fs.chmodSync(getSessionDir(), 0o755);
    assert.equal(checkUsable(), undefined);
    assert.equal(modeOf(base), 0o755);
    assert.equal(modeOf(path.join(base, 'sessions')), 0o700);
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
        assert.equal(error.exitCode, 103);
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
        assert.equal(error.exitCode, 103);
        assert.match(error.message, /symbolic link/);
        return true;
      }
    );
    assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL\n');
  });

  void it('bdg sessions lists a running session in an untrusted directory as untrusted, with why', async () => {
    process.env['BDG_SESSION'] = 'agent-1';
    ensureSessionDir();
    const server = net.createServer();
    const socketPath = path.join(getSessionDir(), 'daemon.sock');
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      fs.chmodSync(getSessionDir(), 0o777);
      const sessions = await listRunningSessions();
      const session = sessions.find((s) => s.name === 'agent-1');
      assert.equal(session?.state, 'untrusted');
      assert.match(session?.untrusted ?? '', /writable by others \(mode 777\)/);
      assert.match(formatSessionList({ sessions }), /agent-1: .*writable by others/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

void describe('session directory suggestions', () => {
  void it('never suggest the shared /tmp/bdg', () => {
    const suggestions = [
      sessionDirIsFileError('/x').suggestion,
      sessionDirNotWritableError('/x', 'EACCES').suggestion,
      socketPathTooLongError('/x/daemon.sock', 95).suggestion,
      sessionNameSocketTooLongError('n', '/x/daemon.sock', 95).suggestion,
      ...(['symlink', 'owner', 'shared', 'writable'] as const).flatMap((kind) =>
        [true, false].map(
          (bdgOwned) =>
            untrustedSessionDirError({ dir: '/tmp', reason: 'r', kind, bdgOwned }).suggestion
        )
      ),
    ];
    for (const suggestion of suggestions) {
      assert.doesNotMatch(suggestion, /\/tmp\/bdg(?![-\w])/);
    }
  });
});
