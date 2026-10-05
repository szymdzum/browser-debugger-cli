/**
 * Named sessions (#131): name validation, directory layout, port choice and
 * the `bdg sessions` list.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CommandError } from '@/errors/index.js';
import {
  getSessionBaseDir,
  getSessionDir,
  getSessionFilePath,
  getSessionName,
  listSessionDirs,
} from '@/session/paths.js';
import { findAvailablePort, firstCandidatePort, getSessionPort } from '@/session/port.js';
import { portsClaimedByOtherSessions, withPortLock } from '@/session/portClaims.js';
import { toRunningSession } from '@/session/sessionList.js';
import { selectSession, validateSessionName } from '@/session/sessionName.js';
import { formatSessionList } from '@/ui/formatters/sessions.js';
import { formatNoSessionMessage } from '@/ui/formatters/status.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const savedEnv = { dir: process.env['BDG_SESSION_DIR'], name: process.env['BDG_SESSION'] };
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
  delete process.env['BDG_SESSION'];
});

afterEach(() => {
  restoreEnv('BDG_SESSION_DIR', savedEnv.dir);
  restoreEnv('BDG_SESSION', savedEnv.name);
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
    for (const name of ['a', 'agent-1', 'Agent_2', 'x'.repeat(40)]) validateSessionName(name);
  });

  void it('rejects other names with exit 81 and a suggestion', () => {
    for (const name of ['', 'a b', '../x', 'a/b', '.hidden', 'ü', 'x'.repeat(41)]) {
      assertInvalid(() => validateSessionName(name), /Invalid session name/);
    }
  });

  void it('rejects a name whose socket path would be too long', () => {
    process.env['BDG_SESSION_DIR'] = path.join(base, 'd'.repeat(80));
    assertInvalid(() => validateSessionName('agent-1'), /socket path too long/);
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
    assert.equal(fs.existsSync(path.join(base, 'port.lock')), false);
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
    const lockPath = path.join(base, 'port.lock');
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
});
