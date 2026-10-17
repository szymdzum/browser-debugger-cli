/**
 * `--stop-after` smoke test (#465 D7): a session started with
 * `bdg <url> --stop-after 2` ends by itself after the page has loaded (the
 * daemon's socket goes away), shows its `autoStopAt` and gives no warning.
 * The old `--timeout 2` does the same with one warning, on stderr in human
 * mode and in the `warnings` of the `--json` envelope. The test waits for
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

const OLD_WARNING =
  '"bdg <url> --timeout" is deprecated and will be removed in 1.0: use "bdg <url> --stop-after"';

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
 * Start a session with a flag for the auto-stop and wait for it to end.
 *
 * @param flag - `--stop-after` or an old spelling
 * @param json - Whether to ask for `--json`
 * @returns Start output
 */
async function startAndWaitForStop(
  flag: string,
  json: boolean
): Promise<{ stdout: string; stderr: string }> {
  const port = await getFreePort();
  const args = [`${fixture.url}key-log`, flag, '2', '--port', String(port), '--headless'];
  const [url = '', ...rest] = json ? [...args, '--json'] : args;
  const result = await runCommand(url, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  await untilSessionEnds();
  return result;
}

void describe('bdg <url> --stop-after (#465 D7)', () => {
  void it('--stop-after ends the session by itself, no warning', async () => {
    const { stdout, stderr } = await startAndWaitForStop('--stop-after', true);
    const envelope = JSON.parse(stdout) as StartEnvelope;
    assert.ok(envelope.data?.autoStopAt, stdout);
    assert.equal(envelope.warnings, undefined);
    assert.ok(!stderr.includes('Warning:'), stderr);
  });

  void it('--timeout still ends the session, with one warning on stderr', async () => {
    const { stderr } = await startAndWaitForStop('--timeout', false);
    assert.deepEqual(
      stderr.split('\n').filter((line) => line.startsWith('Warning: ')),
      [`Warning: ${OLD_WARNING}`]
    );
  });

  void it('-t still ends the session, with the warning in the envelope', async () => {
    const { stdout, stderr } = await startAndWaitForStop('-t', true);
    const envelope = JSON.parse(stdout) as StartEnvelope;
    assert.ok(envelope.data?.autoStopAt, stdout);
    assert.deepEqual(envelope.warnings, [OLD_WARNING]);
    assert.ok(!stderr.includes('Warning:'), stderr);
  });
});
