/**
 * Smoke test for a session whose daemon lost its socket: a new start stops
 * that daemon first (one Chrome, not two), and `cleanup --force` leaves no
 * Chrome of the session running.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import { chromeSessionMarkerFlag } from '@/connection/launcher/flagsBuilder.js';
import { listProcesses } from '@/utils/process.js';

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Browser processes (not helpers) launched for the test session directory.
 *
 * @returns Their PIDs
 */
function sessionChromes(): number[] {
  const marker = chromeSessionMarkerFlag(ensureTestSessionDir());
  return listProcesses()
    .filter(({ command }) => command.includes(marker) && !command.includes('--type='))
    .map(({ pid }) => pid);
}

/**
 * Browser processes of the test session still running once they are all gone
 * or 15 s passed (a killed Chrome takes a moment to be reaped).
 *
 * @returns Their PIDs
 */
async function sessionChromesOnceGone(): Promise<number[]> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const pids = sessionChromes();
    if (pids.length === 0 || Date.now() > deadline) return pids;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

void describe('session recovery', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('stops a daemon that lost its socket before starting again, and cleans up every Chrome', async () => {
    await bdg([fixture.url, '--port', String(await getFreePort()), '--headless']);
    assert.equal(sessionChromes().length, 1);
    fs.rmSync(path.join(ensureTestSessionDir(), 'daemon.sock'), { force: true });

    await bdg([fixture.url, '--port', String(await getFreePort()), '--headless']);
    assert.equal(sessionChromes().length, 1, 'the unreachable daemon closed its Chrome');
    assert.match(await bdg(['status']), /Session active/);

    await bdg(['cleanup', '--force']);
    assert.deepEqual(await sessionChromesOnceGone(), []);
  });
});
