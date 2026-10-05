/**
 * Named sessions smoke test (#131).
 *
 * Two named sessions started at the same time without `--port` get their own
 * daemon, Chrome and port; every command talks to the session it names, and
 * stopping one leaves the other running.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions, waitForProcessExit } from '@/__testutils__/daemonHelpers.js';
import { startFixtureServer, type FixtureServer } from '@/__testutils__/fixtureServer.js';
import { isProcessAlive } from '@/utils/process.js';

interface StartData {
  session?: string;
  port: number;
  chromePid: number;
  daemonPid: number;
}

interface StatusData {
  session?: string;
  active: boolean;
  port?: number;
}

interface SessionsData {
  sessions: { name: string | null; state: string; url?: string; port?: number }[];
}

/**
 * A short base directory for these sessions: named sessions live two levels
 * below it, and a daemon socket path must stay under ~100 bytes, which the
 * repository's .tmp path can exceed.
 */
const sessionBaseDir = fs.mkdtempSync('/tmp/bdg-ns-');
const sessionEnv = { BDG_SESSION_DIR: sessionBaseDir };

/**
 * Run a command and parse its JSON envelope.
 *
 * @param command - Command (or URL)
 * @param args - Arguments
 * @param env - Extra environment
 * @returns Exit code and envelope data
 */
async function runJson<T>(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<{ exitCode: number; data: T; raw: string }> {
  const result = await runCommand(command, [...args, '--json'], {
    timeout: 60000,
    env: { ...sessionEnv, ...env },
  });
  const envelope = JSON.parse(result.stdout || '{}') as { data: T };
  return { exitCode: result.exitCode, data: envelope.data, raw: result.stdout + result.stderr };
}

void describe('named sessions', () => {
  const names = ['smoke-a', 'smoke-b'];
  const pids: number[] = [];
  let fixture: FixtureServer;
  let started: StartData[];

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    for (const name of names) {
      await runCommand('cleanup', ['--force', '--session', name], {
        timeout: 15000,
        env: sessionEnv,
      });
    }
    pids.filter(isProcessAlive).forEach((pid) => process.kill(pid, 'SIGKILL'));
    await cleanupAllSessions();
    await fixture.close();
    fs.rmSync(sessionBaseDir, { recursive: true, force: true });
  });

  void it('starts two named sessions in parallel on different ports', async () => {
    const results = await Promise.all([
      runJson<StartData>(`${fixture.url}deep`, ['--session', 'smoke-a', '--headless']),
      runJson<StartData>(`${fixture.url}eval-frames`, ['--headless'], { BDG_SESSION: 'smoke-b' }),
    ]);
    for (const result of results) assert.equal(result.exitCode, 0, result.raw);
    started = results.map((result) => result.data);
    pids.push(...started.flatMap((data) => [data.daemonPid, data.chromePid]));
    assert.deepEqual(
      started.map((data) => data.session),
      names
    );
    assert.notEqual(started[0]?.port, started[1]?.port);
    assert.ok(started.every((data) => data.port > 9222));
  });

  void it('sends each command to its own session', async () => {
    const titles = await Promise.all(
      names.map((name) =>
        runJson<{ result: string }>('dom', ['eval', 'document.title', '--session', name])
      )
    );
    assert.deepEqual(
      titles.map((title) => title.data.result),
      ['deep', 'eval frames']
    );

    const groupLevel = await runJson<{ result: string }>('dom', [
      '--session',
      'smoke-a',
      'eval',
      'document.title',
    ]);
    assert.equal(groupLevel.data.result, 'deep', '--session between the group and the command');

    const status = await runJson<StatusData>('--session', ['smoke-b', 'status']);
    assert.equal(status.data.session, 'smoke-b');
    assert.equal(status.data.port, started[1]?.port);

    const defaultStatus = await runJson<StatusData>('status', []);
    assert.equal(defaultStatus.data.active, false);
    assert.equal(defaultStatus.data.session, undefined);
  });

  void it('lists both sessions', async () => {
    const list = await runJson<SessionsData>('sessions', []);
    assert.deepEqual(
      list.data.sessions.map(({ name, state, url, port }) => ({ name, state, url, port })),
      [
        { name: 'smoke-a', state: 'active', url: `${fixture.url}deep`, port: started[0]?.port },
        {
          name: 'smoke-b',
          state: 'active',
          url: `${fixture.url}eval-frames`,
          port: started[1]?.port,
        },
      ]
    );
  });

  void it('stops one session without touching the other', async () => {
    const [a, b] = started;
    assert.ok(a && b);
    assert.equal(
      (await runCommand('stop', ['--session', 'smoke-a'], { timeout: 60000, env: sessionEnv }))
        .exitCode,
      0
    );
    assert.equal(await waitForProcessExit(a.chromePid), true);
    assert.equal(await waitForProcessExit(a.daemonPid), true);
    assert.equal(isProcessAlive(b.chromePid), true);

    const statusB = await runJson<StatusData>('status', ['--session', 'smoke-b']);
    assert.equal(statusB.data.active, true);

    const stopB = await runCommand('stop', [], {
      timeout: 60000,
      env: { ...sessionEnv, BDG_SESSION: 'smoke-b' },
    });
    assert.equal(stopB.exitCode, 0, stopB.stderr);
    assert.equal(await waitForProcessExit(b.chromePid), true);
    assert.equal(await waitForProcessExit(b.daemonPid), true);
    assert.deepEqual((await runJson<SessionsData>('sessions', [])).data.sessions, []);
  });
});
