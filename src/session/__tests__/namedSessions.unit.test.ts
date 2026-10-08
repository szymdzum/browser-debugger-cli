/**
 * Named sessions (#131): name validation, directory layout, port choice and
 * the `bdg sessions` list.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { chromeSessionMarkerFlag } from '@/connection/launcher/flagsBuilder.js';
import { CommandError } from '@/errors/index.js';
import { findConflictingOwner } from '@/session/chromeOwners.js';
import {
  MAX_DAEMON_SOCKET_PATH_BYTES,
  getSessionBaseDir,
  getSessionDir,
  getSessionFilePath,
  getSessionName,
  listSessionDirs,
} from '@/session/paths.js';
import { findAvailablePort, firstCandidatePort, getSessionPort } from '@/session/port.js';
import {
  getPortRegistryDir,
  portsClaimedByOtherSessions,
  withPortLock,
} from '@/session/portClaims.js';
import { listRunningSessions, toRunningSession } from '@/session/sessionList.js';
import { selectSession, validateSessionName } from '@/session/sessionName.js';
import { formatSessionList } from '@/ui/formatters/sessions.js';
import { formatNoSessionMessage } from '@/ui/formatters/status.js';
import { untrustedDirReason } from '@/utils/directories.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { DAEMON_SCRIPT_PATH } from '@/utils/packageRoot.js';
import { isProcessAlive } from '@/utils/process.js';

const savedEnv = {
  dir: process.env['BDG_SESSION_DIR'],
  name: process.env['BDG_SESSION'],
  registry: process.env['BDG_PORT_REGISTRY_DIR'],
};
let base: string;

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
 * Create a session directory that looks like a running session claiming a port.
 *
 * @param name - Session name
 * @param port - Port in its port.txt
 */
function fakeRunningSession(name: string, port: number): void {
  const dir = path.join(base, 'sessions', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'daemon.sock'), '');
  fs.writeFileSync(path.join(dir, 'port.txt'), String(port));
}

/**
 * Assert that a function throws an invalid-arguments CommandError.
 *
 * @param fn - Function to run
 * @param message - Expected message pattern
 */
function assertInvalid(fn: () => void, message: RegExp): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(error.message, message);
    assert.ok(error.metadata.suggestion);
    return true;
  });
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-131-'));
  process.env['BDG_SESSION_DIR'] = base;
  process.env['BDG_PORT_REGISTRY_DIR'] = path.join(base, 'ports');
  delete process.env['BDG_SESSION'];
});

afterEach(() => {
  restoreEnv('BDG_SESSION_DIR', savedEnv.dir);
  restoreEnv('BDG_SESSION', savedEnv.name);
  restoreEnv('BDG_PORT_REGISTRY_DIR', savedEnv.registry);
  fs.rmSync(base, { recursive: true, force: true });
});

void describe('session directory', () => {
  void it('is the base directory for the default session', () => {
    assert.equal(getSessionName(), null);
    assert.equal(getSessionDir(), base);
    assert.equal(getSessionFilePath('DAEMON_SOCKET'), path.join(base, 'daemon.sock'));
  });

  void it('is <base>/sessions/<name> for a named session', () => {
    process.env['BDG_SESSION'] = 'agent-1';
    assert.equal(getSessionBaseDir(), base);
    assert.equal(getSessionDir(), path.join(base, 'sessions', 'agent-1'));
    assert.equal(
      getSessionFilePath('METADATA'),
      path.join(base, 'sessions', 'agent-1', 'session.meta.json')
    );
  });

  void it('treats an empty BDG_SESSION as the default session', () => {
    process.env['BDG_SESSION'] = '  ';
    assert.equal(getSessionName(), null);
    assert.equal(getSessionDir(), base);
  });

  void it('lists the default session first, then named sessions by name', () => {
    fs.mkdirSync(path.join(base, 'sessions', 'b'), { recursive: true });
    fs.mkdirSync(path.join(base, 'sessions', 'a'), { recursive: true });
    fs.writeFileSync(path.join(base, 'sessions', 'not-a-dir'), '');
    assert.deepEqual(
      listSessionDirs().map((entry) => entry.name),
      [null, 'a', 'b']
    );
  });
});

void describe('session name validation', () => {
  void it('accepts letters, digits, - and _ up to 40 characters', () => {
    process.env['BDG_SESSION_DIR'] = '/tmp/b';
    for (const name of ['a', 'agent-1', 'Agent_2', '1st', 'x'.repeat(40)]) {
      validateSessionName(name);
    }
  });

  void it('rejects other names with exit 81 and a suggestion', () => {
    for (const name of ['', 'a b', '../x', 'a/b', '.hidden', 'ü', 'x'.repeat(41)]) {
      assertInvalid(() => validateSessionName(name), /Invalid session name/);
    }
  });

  void it('blames the name when only a shorter name would fit the socket path', () => {
    const fixedBytes = '/tmp/'.length + '/sessions/'.length + '/daemon.sock'.length;
    process.env['BDG_SESSION_DIR'] =
      `/tmp/${'d'.repeat(MAX_DAEMON_SOCKET_PATH_BYTES - fixedBytes - 1)}`;
    validateSessionName('a');
    assertInvalid(
      () => validateSessionName('agent-1'),
      /Session name "agent-1" .*socket path too long/
    );
  });

  void it('blames the directory when no name would fit the socket path', () => {
    process.env['BDG_SESSION_DIR'] = path.join(base, 'd'.repeat(80));
    assertInvalid(() => validateSessionName('a'), /Session directory path is too long/);
  });

  void it('rejects names that do not start with a letter or digit', () => {
    for (const name of ['-x', '--json', '-h', '_a']) {
      assertInvalid(() => validateSessionName(name), /Invalid session name/);
    }
  });
});

void describe('session selection', () => {
  void it('prefers --session over BDG_SESSION and exports the choice', () => {
    process.env['BDG_SESSION'] = 'from-env';
    selectSession('from-flag');
    assert.equal(process.env['BDG_SESSION'], 'from-flag');
  });

  void it('uses BDG_SESSION without --session', () => {
    process.env['BDG_SESSION'] = 'from-env';
    selectSession(undefined);
    assert.equal(getSessionName(), 'from-env');
  });

  void it('selects the default session without either', () => {
    process.env['BDG_SESSION'] = '';
    selectSession(undefined);
    assert.equal(process.env['BDG_SESSION'], undefined);
  });

  void it('lower-cases names so they are case-insensitive', () => {
    selectSession('ALPHA');
    assert.equal(process.env['BDG_SESSION'], 'alpha');
    assert.equal(getSessionDir(), path.join(base, 'sessions', 'alpha'));
    process.env['BDG_SESSION'] = 'Agent-1';
    assert.equal(getSessionName(), 'agent-1');
  });

  void it('rejects an invalid BDG_SESSION and an empty --session', () => {
    process.env['BDG_SESSION'] = 'bad name';
    assertInvalid(() => selectSession(undefined), /bad name/);
    assertInvalid(() => selectSession(''), /Invalid session name/);
  });
});

void describe('port choice', () => {
  void it('leaves the default port to the default session', () => {
    assert.equal(firstCandidatePort(), 9222);
    process.env['BDG_SESSION'] = 'agent-1';
    assert.equal(firstCandidatePort(), 9223);
  });

  void it('sees only ports of other sessions whose daemon socket exists', () => {
    fakeRunningSession('other', 9250);
    fakeRunningSession('self', 9251);
    fs.mkdirSync(path.join(base, 'sessions', 'stopped'), { recursive: true });
    fs.writeFileSync(path.join(base, 'sessions', 'stopped', 'port.txt'), '9252');
    process.env['BDG_SESSION'] = 'self';
    assert.deepEqual([...portsClaimedByOtherSessions()], [9250]);
  });

  void it('skips claimed ports', async () => {
    const first = await findAvailablePort(9223);
    const next = await findAvailablePort(9223, new Set([first]));
    assert.ok(next > first, `expected a port above ${first}, got ${next}`);
  });

  void it('gives a named session a free port no other session claims, and saves it', async () => {
    const claimed = await findAvailablePort(9223);
    fakeRunningSession('other', claimed);
    process.env['BDG_SESSION'] = 'agent-1';
    const port = await getSessionPort();
    assert.notEqual(port, claimed);
    assert.ok(port >= 9223);
    assert.equal(fs.readFileSync(getSessionFilePath('PORT'), 'utf-8'), String(port));
    assert.equal(fs.existsSync(path.join(getPortRegistryDir(), 'port.lock')), false);
  });

  void it('sees running sessions of other base directories through the registry', async () => {
    const otherBase = path.join(base, 'other-base');
    process.env['BDG_SESSION_DIR'] = otherBase;
    process.env['BDG_SESSION'] = 'remote';
    const remotePort = await getSessionPort();
    fs.writeFileSync(path.join(getSessionDir(), 'daemon.sock'), '');

    process.env['BDG_SESSION_DIR'] = base;
    process.env['BDG_SESSION'] = 'local';
    assert.deepEqual([...portsClaimedByOtherSessions()], [remotePort]);
    assert.notEqual(await getSessionPort(), remotePort);
  });

  void it('ignores registry claims of stopped sessions and changed ports', () => {
    const claims = path.join(getPortRegistryDir(), 'claims');
    const stopped = path.join(base, 'elsewhere', 'stopped');
    const moved = path.join(base, 'elsewhere', 'moved');
    fs.mkdirSync(stopped, { recursive: true });
    fs.mkdirSync(moved, { recursive: true });
    fs.writeFileSync(path.join(stopped, 'port.txt'), '9260');
    fs.writeFileSync(path.join(moved, 'port.txt'), '9262');
    fs.writeFileSync(path.join(moved, 'daemon.sock'), '');
    fs.mkdirSync(claims, { recursive: true });
    fs.writeFileSync(path.join(claims, '9260'), stopped);
    fs.writeFileSync(path.join(claims, '9261'), moved);
    fs.writeFileSync(path.join(claims, '9263'), 'not-a-path');
    process.env['BDG_SESSION'] = 'agent-1';
    assert.deepEqual([...portsClaimedByOtherSessions()], [9262]);
  });

  void it('creates the registry private to the user (mode 0700)', async () => {
    process.env['BDG_SESSION'] = 'agent-1';
    await getSessionPort();
    for (const dir of [getPortRegistryDir(), path.join(getPortRegistryDir(), 'claims')]) {
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700, dir);
    }
  });

  void it('ignores and does not write a registry others can write to', async () => {
    const registry = getPortRegistryDir();
    const claims = path.join(registry, 'claims');
    const remote = path.join(base, 'elsewhere', 'remote');
    fs.mkdirSync(remote, { recursive: true });
    fs.writeFileSync(path.join(remote, 'port.txt'), '9270');
    fs.writeFileSync(path.join(remote, 'daemon.sock'), '');
    fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(claims, '9270'), remote);
    fs.chmodSync(registry, 0o777);
    process.env['BDG_SESSION'] = 'agent-1';
    assert.deepEqual([...portsClaimedByOtherSessions()], []);
    const port = await getSessionPort();
    assert.equal(fs.existsSync(path.join(claims, String(port))), false);
    assert.equal(fs.existsSync(path.join(base, 'port.lock')), false);
  });

  void it('ignores a registry that is a symlink', () => {
    const real = path.join(base, 'real-registry');
    fs.mkdirSync(path.join(real, 'claims'), { recursive: true, mode: 0o700 });
    fs.chmodSync(real, 0o700);
    fs.symlinkSync(real, getPortRegistryDir());
    assert.match(untrustedDirReason(getPortRegistryDir()) ?? '', /symbolic link/);
    fakeRunningSession('other', 9280);
    process.env['BDG_SESSION'] = 'self';
    fs.writeFileSync(path.join(real, 'claims', '9281'), path.join(base, 'nowhere'));
    assert.deepEqual([...portsClaimedByOtherSessions()], [9280]);
  });

  void it('replaces a symlinked claim file instead of writing through it', async () => {
    const claims = path.join(getPortRegistryDir(), 'claims');
    fs.mkdirSync(claims, { recursive: true, mode: 0o700 });
    fs.chmodSync(getPortRegistryDir(), 0o700);
    const victim = path.join(base, 'victim.txt');
    fs.writeFileSync(victim, 'untouched');
    process.env['BDG_SESSION'] = 'agent-1';
    fs.symlinkSync(victim, path.join(claims, '9999'));
    assert.equal(await getSessionPort(9999), 9999);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched');
    assert.equal(fs.lstatSync(path.join(claims, '9999')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(claims, '9999'), 'utf8'), getSessionDir());
  });

  void it('keeps the registry in a per-user directory under the OS temp directory', () => {
    delete process.env['BDG_PORT_REGISTRY_DIR'];
    const dir = getPortRegistryDir();
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.match(path.basename(dir), /^bdg-ports(-\d+)?$/);
  });

  void it('does not reuse a saved port another running session claims', async () => {
    const claimed = await findAvailablePort(9223);
    fakeRunningSession('other', claimed);
    process.env['BDG_SESSION'] = 'agent-1';
    fs.mkdirSync(getSessionDir(), { recursive: true });
    fs.writeFileSync(getSessionFilePath('PORT'), String(claimed));
    assert.notEqual(await getSessionPort(), claimed);
  });

  void it('keeps an explicit port and claims it for a named session', async () => {
    process.env['BDG_SESSION'] = 'agent-1';
    assert.equal(await getSessionPort(9999), 9999);
    assert.equal(fs.readFileSync(getSessionFilePath('PORT'), 'utf-8'), '9999');
  });

  void it('does not save an explicit port of the default session', async () => {
    delete process.env['BDG_SESSION'];
    assert.equal(await getSessionPort(9998), 9998);
    assert.equal(fs.existsSync(getSessionFilePath('PORT')), false);
  });
});

void describe('port lock', () => {
  void it('runs selections one at a time', async () => {
    let running = 0;
    let overlapped = false;
    const select = async (): Promise<number> => {
      running++;
      overlapped ||= running > 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      running--;
      return 1;
    };
    await Promise.all([withPortLock(select), withPortLock(select), withPortLock(select)]);
    assert.equal(overlapped, false);
  });

  void it('removes a lock left by a dead process', async () => {
    const lockPath = path.join(getPortRegistryDir(), 'port.lock');
    fs.mkdirSync(getPortRegistryDir(), { recursive: true });
    fs.writeFileSync(lockPath, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);
    const started = Date.now();
    assert.equal(await withPortLock(() => Promise.resolve(7)), 7);
    assert.ok(Date.now() - started < 1000);
    assert.equal(fs.existsSync(lockPath), false);
  });
});

void describe('session list', () => {
  void it('summarizes an active session', () => {
    const info = toRunningSession('agent-1', {
      daemonPid: 10,
      daemonStartTime: 0,
      socketPath: '/s',
      sessionPid: 10,
      sessionMetadata: { bdgPid: 10, chromePid: 11, startTime: 0, port: 9223 },
      pageState: { url: 'http://a/', title: 'A' },
    });
    assert.deepEqual(info, {
      name: 'agent-1',
      state: 'active',
      url: 'http://a/',
      port: 9223,
      daemonPid: 10,
      chromePid: 11,
    });
  });

  void it('reports a starting session with the URL being opened', () => {
    const info = toRunningSession(null, {
      daemonPid: 10,
      daemonStartTime: 0,
      socketPath: '/s',
      starting: { url: 'http://b/', since: 0 },
    });
    assert.deepEqual(info, { name: null, state: 'starting', url: 'http://b/', daemonPid: 10 });
  });

  void it('formats a table with the default session labelled', () => {
    const text = formatSessionList({
      sessions: [
        { name: null, state: 'active', url: 'http://a/', port: 9222, daemonPid: 1 },
        { name: 'agent-1', state: 'starting', daemonPid: 2 },
      ],
    });
    assert.match(text, /^SESSION\s+STATE\s+PORT\s+PID\s+URL$/m);
    assert.match(text, /^\(default\)\s+active\s+9222\s+1\s+http:\/\/a\/$/m);
    assert.match(text, /^agent-1\s+starting\s+-\s+2\s+-$/m);
    assert.match(formatSessionList({ sessions: [] }), /No running sessions/);
  });

  void it('names the session in the no-session status', () => {
    const text = formatNoSessionMessage({ active: false, session: 'agent-1' });
    assert.match(text, /No active session "agent-1"/);
    assert.match(text, /bdg <url> --session agent-1/);
    assert.match(text, /bdg cleanup --session agent-1/);
  });

  void it('lists stale sessions, and directories --session cannot select', async () => {
    const stale = path.join(base, 'sessions', 'p3');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'daemon.pid'), '999999');
    fs.writeFileSync(path.join(stale, 'session.meta.json'), JSON.stringify({ port: 9226 }));
    fs.mkdirSync(path.join(base, 'sessions', 'stopped'), { recursive: true });
    fs.mkdirSync(path.join(base, 'sessions', '--json'), { recursive: true });
    fs.writeFileSync(path.join(base, 'sessions', '--json', 'daemon.pid'), '1');
    assert.deepEqual(await listRunningSessions(), [
      {
        name: '--json',
        state: 'stale',
        cleanup: `rm -rf '${path.join(base, 'sessions', '--json')}'`,
      },
      { name: 'p3', state: 'stale', port: 9226, cleanup: 'bdg cleanup --session p3' },
    ]);
  });

  void it('lists a directory differing only in case as the session --session reaches', async () => {
    const upper = path.join(base, 'sessions', 'ALPHA');
    fs.mkdirSync(upper, { recursive: true });
    fs.writeFileSync(path.join(upper, 'daemon.pid'), '999999');
    const lower = path.join(base, 'sessions', 'alpha');
    if (isCaseInsensitive(upper)) {
      assert.deepEqual(await listRunningSessions(), [
        { name: 'alpha', state: 'stale', cleanup: 'bdg cleanup --session alpha' },
      ]);
      return;
    }
    assert.deepEqual(await listRunningSessions(), [
      { name: 'ALPHA', state: 'stale', cleanup: `rm -rf '${upper}'` },
    ]);
    fs.mkdirSync(lower);
    fs.writeFileSync(path.join(lower, 'daemon.pid'), '999998');
    assert.deepEqual(await listRunningSessions(), [
      { name: 'ALPHA', state: 'stale', cleanup: `rm -rf '${upper}'` },
      { name: 'alpha', state: 'stale', cleanup: 'bdg cleanup --session alpha' },
    ]);
  });

  void it('lists a session whose daemon runs without its socket as ending', async () => {
    const dir = path.join(base, 'sessions', 'p5');
    fs.mkdirSync(dir, { recursive: true });
    const fakeDaemon = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)', '--', DAEMON_SCRIPT_PATH],
      { stdio: 'ignore' }
    );
    try {
      const pid = fakeDaemon.pid ?? 0;
      fs.writeFileSync(path.join(dir, 'daemon.pid'), String(pid));
      fs.writeFileSync(path.join(dir, 'port.txt'), '9228');
      await waitUntil(() => isProcessAlive(pid));
      assert.deepEqual(await listRunningSessions(), [
        { name: 'p5', state: 'ending', daemonPid: pid },
      ]);
    } finally {
      fakeDaemon.kill('SIGKILL');
    }
  });

  void it('lists a session that ended without bdg stop as ended, with why and when', async () => {
    const dir = path.join(base, 'sessions', 'p6');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'port.txt'), '9229');
    fs.writeFileSync(
      path.join(dir, 'last-session.json'),
      JSON.stringify({ reason: 'crash', endedAt: 1000 })
    );
    const sessions = await listRunningSessions();
    assert.deepEqual(sessions, [
      {
        name: 'p6',
        state: 'ended',
        endReason: 'crash',
        endedAt: 1000,
        cleanup: 'bdg cleanup --session p6',
      },
    ]);
    assert.match(
      formatSessionList({ sessions }),
      /p6\s+ended\s+-\s+-\s+-\n\nEnded without bdg stop:\n\s+p6 ended at .*: Chrome crashed or was closed/
    );
  });

  void it('lists a session whose daemon died while its Chrome runs as crashed', async () => {
    const dir = path.join(base, 'sessions', 'p4');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'port.txt'), '9227');
    const fakeChrome = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)', '--', chromeSessionMarkerFlag(dir)],
      { stdio: 'ignore' }
    );
    try {
      const pid = fakeChrome.pid ?? 0;
      fs.writeFileSync(path.join(dir, 'chrome.pid'), String(pid));
      await waitUntil(() => isProcessAlive(pid));
      assert.deepEqual(await listRunningSessions(), [
        {
          name: 'p4',
          state: 'crashed',
          port: 9227,
          chromePid: pid,
          cleanup: 'bdg cleanup --session p4',
        },
      ]);
      assert.match(
        formatSessionList({ sessions: await listRunningSessions() }),
        /p4\s+crashed\s+9227[\s\S]*clean up with:\n\s+bdg cleanup --session p4/
      );
    } finally {
      fakeChrome.kill('SIGKILL');
    }
  });
});

/**
 * Whether the file system of a directory ignores case in names.
 *
 * @param dir - Existing directory whose name has upper-case letters
 * @returns True if the lower-cased path names the same directory
 */
function isCaseInsensitive(dir: string): boolean {
  const lower = path.join(path.dirname(dir), path.basename(dir).toLowerCase());
  return fs.existsSync(lower) && fs.statSync(lower).ino === fs.statSync(dir).ino;
}

/**
 * Poll until a condition holds (up to 2 s).
 *
 * @param condition - Condition to wait for
 */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * A directory that looks like a running session driving a tab: a listening
 * daemon socket and metadata.
 *
 * @param name - Session name
 * @param meta - Metadata (targetId, chromePid)
 * @returns Server to close after the test
 */
async function fakeLiveSession(
  name: string,
  meta: { targetId: string; chromePid: number }
): Promise<net.Server> {
  const dir = path.join(base, 'sessions', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.meta.json'), JSON.stringify({ port: 9930, ...meta }));
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(path.join(dir, 'daemon.sock'), resolve));
  return server;
}

void describe('Chrome owners (attach)', () => {
  void it('finds a session that launched the Chrome, or drives the tab to attach to', async () => {
    const launched = await fakeLiveSession('alpha', { targetId: 'T1', chromePid: 4242 });
    const attached = await fakeLiveSession('att1', { targetId: 'T2', chromePid: 0 });
    try {
      process.env['BDG_SESSION'] = 'spy';
      assert.equal((await findConflictingOwner(['T1', 'T9'], 'T9'))?.name, 'alpha');
      assert.equal((await findConflictingOwner(['T2', 'T3'], 'T2'))?.name, 'att1');
      assert.equal(await findConflictingOwner(['T2', 'T3'], 'T3'), null, 'another tab is free');
      assert.equal(await findConflictingOwner(['T7'], 'T7'), null);
      process.env['BDG_SESSION'] = 'alpha';
      assert.equal((await findConflictingOwner(['T1', 'T2'], 'T2'))?.name, 'att1');
    } finally {
      launched.close();
      attached.close();
    }
  });

  void it('ignores sessions whose socket is stale or whose metadata has no targetId', async () => {
    const stale = path.join(base, 'sessions', 'gone');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'daemon.sock'), '');
    fs.writeFileSync(
      path.join(stale, 'session.meta.json'),
      JSON.stringify({ targetId: 'T1', chromePid: 4242 })
    );
    const noTarget = await fakeLiveSession('blank', { targetId: 'T1', chromePid: 4242 });
    fs.writeFileSync(
      path.join(base, 'sessions', 'blank', 'session.meta.json'),
      JSON.stringify({ port: 9930, chromePid: 4242 })
    );
    try {
      process.env['BDG_SESSION'] = 'spy';
      assert.equal(await findConflictingOwner(['T1'], 'T1'), null);
    } finally {
      noTarget.close();
    }
  });
});
