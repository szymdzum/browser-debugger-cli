/**
 * `peek --json` and `peek --follow --json` carry the time the snapshot was
 * taken in `data.timestamp` (#727), not the start of the session.
 *
 * Timing: nothing waits a fixed time. Each peek is made after the clock has
 * passed the previous snapshot; the stream is read until it has printed two
 * lines.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

const COMMAND_TIMEOUT_MS = 60000;

/** Window of one command and the snapshot time it reported */
interface Stamped {
  at: number;
  before: number;
  after: number;
}

/**
 * Wait until the clock has passed an instant.
 *
 * @param instant - Epoch ms to pass
 */
async function passTime(instant: number): Promise<void> {
  while (Date.now() <= instant) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Run `peek --json` once.
 *
 * @returns The snapshot time and the window of the call
 */
async function peekOnce(): Promise<Stamped> {
  const before = Date.now();
  const result = await runCommand('peek', ['--json'], { timeout: COMMAND_TIMEOUT_MS });
  const after = Date.now();
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout) as { data: { timestamp: string } };
  return { at: Date.parse(body.data.timestamp), before, after };
}

void describe('peek timestamp (#727)', () => {
  let fixture: FixtureServer;
  let sessionStart: number;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const started = await runCommand(
      `${fixture.url}action-errors`,
      ['--port', String(await getFreePort()), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(started.exitCode, 0, started.stderr);
    sessionStart = Date.now();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('two peek --json calls report when each snapshot was taken', async () => {
    const first = await peekOnce();
    await passTime(first.after);
    const second = await peekOnce();
    for (const stamp of [first, second]) {
      assert.ok(stamp.at >= stamp.before && stamp.at <= stamp.after, JSON.stringify(stamp));
      assert.ok(stamp.at > sessionStart, 'not the session start');
    }
    assert.ok(second.at > first.at, 'the second snapshot is later');
  });

  void it('each peek --follow --json line reports its own snapshot time', async () => {
    const stop = new AbortController();
    const before = Date.now();
    const result = await runCommand('peek', ['--follow', '--json', '--interval', '200'], {
      timeout: COMMAND_TIMEOUT_MS,
      interrupt: stop.signal,
      onStdout: (stdout) => {
        if (stdout.split('\n').filter((line) => line.startsWith('{')).length >= 2) stop.abort();
      },
    });
    const after = Date.now();
    const stamps = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => Date.parse((JSON.parse(line) as { data: { timestamp: string } }).data.timestamp));
    assert.ok(stamps.length >= 2, result.stdout);
    for (const at of stamps) assert.ok(at >= before && at <= after, `${at} outside window`);
    assert.ok(stamps[1]! > stamps[0]!, 'the second line is later');
  });
});
