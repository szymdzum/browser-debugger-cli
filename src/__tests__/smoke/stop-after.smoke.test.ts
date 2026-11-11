/**
 * `--stop-after` smoke test (#465 D7): a session started with
 * `bdg <url> --stop-after 2` ends by itself after the page has loaded (the
 * daemon's socket goes away), shows its `autoStopAt` and gives no warning
 * (the old `-t/--timeout` exits 81 since 1.0). The test waits for
 * the socket to go, with a generous deadline; it asserts no upper bound on
 * the time. The `attach` cells are in `attach.smoke.test.ts`.
 */

import * as assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions, isDaemonRunning } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

interface StartEnvelope {
  success: boolean;
  data?: { autoStopAt?: string };
  warnings?: string[];
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
});

afterEach(async () => {
  await cleanupAllSessions();
});

after(async () => {
  await fixture.close();
});

/**
 * Wait until the session's daemon is gone.
 */
async function untilSessionEnds(): Promise<void> {
  const deadline = Date.now() + 40000;
  while (await isDaemonRunning()) {
    assert.ok(Date.now() < deadline, 'the session did not stop by itself within 40 s');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Start a session with `--stop-after 2 --json` and wait for it to end.
 *
 * @returns Start output
 */
async function startAndWaitForStop(): Promise<{ stdout: string; stderr: string }> {
  const port = await getFreePort();
  const rest = ['--stop-after', '2', '--port', String(port), '--headless', '--json'];
  const result = await runCommand(`${fixture.url}key-log`, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  await untilSessionEnds();
  return result;
}

void describe('bdg <url> --stop-after (#465 D7)', () => {
  void it('--stop-after ends the session by itself, no warning', async () => {
    const { stdout, stderr } = await startAndWaitForStop();
    const envelope = JSON.parse(stdout) as StartEnvelope;
    assert.ok(envelope.data?.autoStopAt, stdout);
    assert.equal(envelope.warnings, undefined);
    assert.ok(!stderr.includes('Warning:'), stderr);
  });
});
