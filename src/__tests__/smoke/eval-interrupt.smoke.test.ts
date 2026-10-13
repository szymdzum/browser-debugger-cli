/**
 * An interrupted `bdg dom eval` stops its script on the page (#713).
 *
 * When the CLI that sent an eval exits (Ctrl-C) while the script still
 * runs, the daemon terminates the script instead of letting it run to its
 * 20 s limit: the next eval answers at once, and an eval another CLI sent
 * meanwhile (queued behind the busy script) answers too, never 102 or 130.
 *
 * The signal is sent once the script has told the fixture server it is
 * looping (a synchronous `/beacon?…` request before the loop); the times
 * are measured, and the commands are awaited, not slept for.
 */

import * as assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/** How long the interrupted script would keep the page busy */
const LOOP_MS = 20_000;

/** Upper bound for every command: well past the loop and the eval's own limit */
const COMMAND_TIMEOUT_MS = 60_000;

/** How fast the page must answer again once the eval was interrupted */
const ANSWER_WITHIN_MS = 3_000;

/**
 * A script that tells the fixture server it started, then busy-waits.
 *
 * @param tag - Beacon query string
 * @returns Script source
 */
function loopScript(tag: string): string {
  return `(() => { const r = new XMLHttpRequest(); r.open('GET', '/beacon?${tag}', false); r.send(); const end = Date.now() + ${LOOP_MS}; while (Date.now() < end); return 'finished'; })()`;
}

/**
 * Describe a command result for assertion messages.
 *
 * @param result - Command result
 * @returns Exit code, stdout and stderr
 */
function shown(result: CommandResult): string {
  return `exit ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
}

void describe('Interrupted dom eval', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}eval-frames`,
      ['--port', String(port), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  beforeEach(() => {
    fixture.beacons.length = 0;
  });

  /**
   * Wait until the page sent the beacon `tag`.
   *
   * @param tag - Beacon query string
   */
  async function untilBeacon(tag: string): Promise<void> {
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
    while (!fixture.beacons.includes(tag) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fixture.beacons.includes(tag), `the script never started (${tag})`);
  }

  /**
   * Start a looping eval; it is interrupted when `stop` aborts.
   *
   * @param tag - Beacon query string
   * @param stop - Aborted to send SIGINT
   * @param frame - `--frame` value, if any
   * @returns The eval's result
   */
  function startLoop(tag: string, stop: AbortSignal, frame?: string): Promise<CommandResult> {
    const frameArgs = frame === undefined ? [] : ['--frame', frame];
    return runCommand('dom', ['eval', loopScript(tag), ...frameArgs, '--json'], {
      timeout: COMMAND_TIMEOUT_MS,
      interrupt: stop,
    });
  }

  /**
   * Run `dom eval 1+1` and measure how long it took.
   *
   * @param frame - `--frame` value, if any
   * @returns The result and its duration
   */
  async function timedEval(frame?: string): Promise<{ result: CommandResult; ms: number }> {
    const frameArgs = frame === undefined ? [] : ['--frame', frame];
    const startedAt = Date.now();
    const result = await runCommand('dom', ['eval', '1+1', ...frameArgs], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    return { result, ms: Date.now() - startedAt };
  }

  /**
   * Interrupt a looping eval, then check the next eval answers at once.
   *
   * @param tag - Beacon query string
   * @param frame - `--frame` value, if any
   */
  async function interruptThenEval(tag: string, frame?: string): Promise<void> {
    const stop = new AbortController();
    const loop = startLoop(tag, stop.signal, frame);
    await untilBeacon(tag);
    stop.abort();
    const interrupted = await loop;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    const next = await timedEval(frame);
    assert.equal(next.result.exitCode, 0, shown(next.result));
    assert.equal(next.result.stdout.trim(), '2', shown(next.result));
    assert.ok(
      next.ms < ANSWER_WITHIN_MS,
      `the next eval answered after ${next.ms} ms (limit ${ANSWER_WITHIN_MS} ms)`
    );
  }

  void it('stops the script so the next eval answers at once', async () => {
    await interruptThenEval('page-loop');
  });

  void it('says the script was stopped on the page', async () => {
    const stop = new AbortController();
    const loop = startLoop('message-loop', stop.signal);
    await untilBeacon('message-loop');
    stop.abort();
    const result = await loop;
    assert.equal(result.exitCode, 130, shown(result));
    const envelope = JSON.parse(result.stdout.trim()) as { suggestion?: string };
    assert.match(envelope.suggestion ?? '', /stopped on the page/, shown(result));
    assert.match(envelope.suggestion ?? '', /bdg peek/, shown(result));
  });

  void it('lets an eval sent meanwhile by another client answer', async () => {
    const stop = new AbortController();
    const loop = startLoop('parallel-loop', stop.signal);
    await untilBeacon('parallel-loop');
    const sent = new AbortController();
    const startedAt = Date.now();
    const other = runCommand('dom', ['eval', '1+1', '--debug'], {
      timeout: COMMAND_TIMEOUT_MS,
      onStderr: (stderr) => {
        if (stderr.includes('Connected to daemon')) sent.abort();
      },
    });
    await new Promise((resolve) => sent.signal.addEventListener('abort', resolve, { once: true }));
    const interruptedAt = Date.now();
    stop.abort();
    const [interrupted, answered] = await Promise.all([loop, other]);
    const answeredAfter = Date.now() - interruptedAt;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    assert.equal(answered.exitCode, 0, shown(answered));
    assert.equal(answered.stdout.trim(), '2', shown(answered));
    assert.ok(
      answeredAfter < ANSWER_WITHIN_MS,
      `the other eval answered ${answeredAfter} ms after the interrupt (sent ${interruptedAt - startedAt} ms before it)`
    );
  });

  void it('stops a script in a same-origin iframe (--frame)', async () => {
    await interruptThenEval('same-frame-loop', 'same');
  });

  void it('stops a script in an out-of-process iframe (--frame)', async () => {
    await interruptThenEval('cross-frame-loop', 'cross');
  });

  void it('answers status normally afterwards', async () => {
    const status = await runCommand('status', ['--json'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(status.exitCode, 0, shown(status));
  });
});
