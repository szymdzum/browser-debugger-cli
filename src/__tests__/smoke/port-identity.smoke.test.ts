/**
 * Sessions of different session directories (#314).
 *
 * Two named sessions started at the same time from two `BDG_SESSION_DIR`s get
 * their own port and drive their own Chrome: port claims are machine-wide,
 * and bdg checks that the Chrome answering on the port is the one it
 * launched. Stopping one leaves the other running.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { waitForProcessExit } from '@/__testutils__/daemonHelpers.js';
import { startFixtureServer, type FixtureServer } from '@/__testutils__/fixtureServer.js';
import { isProcessAlive } from '@/utils/process.js';

interface StartData {
  port: number;
  chromePid: number;
  daemonPid: number;
}

interface StatusData {
  active: boolean;
  port?: number;
  targetId?: string;
}

/** One session: its own short base directory (socket paths must stay short) and name */
interface SessionSpec {
  env: Record<string, string>;
  name: string;
  page: string;
  title: string;
}

const sessions: SessionSpec[] = [
  { name: 'pid-a', page: 'deep', title: 'deep' },
  { name: 'pid-b', page: 'eval-frames', title: 'eval frames' },
].map((spec) => ({ ...spec, env: { BDG_SESSION_DIR: fs.mkdtempSync('/tmp/bdg-pi-') } }));

/**
 * Run a command in a session and parse its JSON envelope.
 *
 * @param session - Session
 * @param command - Command (or URL)
 * @param args - Arguments
 * @returns Exit code and envelope data
 */
async function runJson<T>(
  session: SessionSpec,
  command: string,
  args: string[] = []
): Promise<{ exitCode: number; data: T; raw: string }> {
  const result = await runCommand(command, [...args, '--session', session.name, '--json'], {
    timeout: 60000,
    env: session.env,
  });
  const envelope = JSON.parse(result.stdout || '{}') as { data: T };
  return { exitCode: result.exitCode, data: envelope.data, raw: result.stdout + result.stderr };
}

void describe('sessions of different session directories', () => {
  const pids: number[] = [];
  let fixture: FixtureServer;
  let started: StartData[];

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    for (const session of sessions) {
      await runCommand('cleanup', ['--force', '--session', session.name], {
        timeout: 15000,
        env: session.env,
      });
    }
    pids.filter(isProcessAlive).forEach((pid) => process.kill(pid, 'SIGKILL'));
    await fixture.close();
    for (const session of sessions) {
      fs.rmSync(session.env['BDG_SESSION_DIR'] ?? '', { recursive: true, force: true });
    }
  });

  void it('start in parallel on different ports with their own Chrome', async () => {
    const results = await Promise.all(
      sessions.map((session) =>
        runJson<StartData>(session, `${fixture.url}${session.page}`, ['--headless'])
      )
    );
    for (const result of results) assert.equal(result.exitCode, 0, result.raw);
    started = results.map((result) => result.data);
    pids.push(...started.flatMap((data) => [data.daemonPid, data.chromePid]));
    assert.notEqual(started[0]?.port, started[1]?.port);
    assert.notEqual(started[0]?.chromePid, started[1]?.chromePid);
  });

  void it('drive different pages', async () => {
    const statuses = await Promise.all(sessions.map((s) => runJson<StatusData>(s, 'status')));
    assert.deepEqual(
      statuses.map((status) => status.data.port),
      started.map((data) => data.port)
    );
    const [targetA, targetB] = statuses.map((status) => status.data.targetId);
    assert.ok(targetA && targetB);
    assert.notEqual(targetA, targetB);

    const titles = await Promise.all(
      sessions.map((s) => runJson<{ result: string }>(s, 'dom', ['eval', 'document.title']))
    );
    assert.deepEqual(
      titles.map((title) => title.data.result),
      sessions.map((session) => session.title)
    );
  });

  void it('stop independently', async () => {
    const [a, b] = started;
    const [sessionA, sessionB] = sessions;
    assert.ok(a && b && sessionA && sessionB);
    assert.equal((await runJson(sessionA, 'stop')).exitCode, 0);
    assert.equal(await waitForProcessExit(a.chromePid), true);
    assert.equal(isProcessAlive(b.chromePid), true);
    assert.equal((await runJson<StatusData>(sessionB, 'status')).data.active, true);
    assert.equal((await runJson(sessionB, 'stop')).exitCode, 0);
    assert.equal(await waitForProcessExit(b.chromePid), true);
  });
});
