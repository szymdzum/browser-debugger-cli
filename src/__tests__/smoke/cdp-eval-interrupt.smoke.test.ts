/**
 * An interrupted raw `bdg cdp Runtime.evaluate` / `Runtime.callFunctionOn`
 * stops its script on the page, like `bdg dom eval` (#726, #713).
 *
 * When the CLI that sent the call exits (Ctrl-C) while the script still
 * runs, the daemon terminates the script instead of letting it run to its
 * end: the next command answers at once, and the Ctrl-C message says the
 * script was stopped. A call queued behind another client's running script
 * leaves that script alone when it is interrupted (#724).
 *
 * Signals are sent once the command is known to be where the test needs
 * it: a looping script has told the fixture server it started (a
 * synchronous `/beacon?…` request before the loop), and a queued call has
 * been sent to Chrome (the daemon's `dom eval sent` debug line in
 * `daemon.log`, the session runs with `BDG_DEBUG=1`).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';

/** How long an interrupted script would keep the page busy */
const LOOP_MS = 30_000;

/** How long a script that is left to finish keeps the page busy */
const SHORT_LOOP_MS = 3_000;

/** Upper bound for every command: well past the loop */
const COMMAND_TIMEOUT_MS = 60_000;

/** How fast the page must answer again once the call was interrupted */
const ANSWER_WITHIN_MS = 5_000;

/** The daemon's debug line for a script call sent to Chrome */
const SENT_LINE = 'dom eval sent';

/**
 * The body of a script that tells the fixture server it started, then busy-waits.
 *
 * @param tag - Beacon query string
 * @param ms - How long it loops
 * @returns Statements, ending in `return 'finished'`
 */
function loopBody(tag: string, ms: number): string {
  return `const r = new XMLHttpRequest(); r.open('GET', '/beacon?${tag}', false); r.send(); const end = Date.now() + ${ms}; while (Date.now() < end); return 'finished';`;
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

/**
 * How many script calls the daemon has sent to Chrome so far.
 *
 * @returns Count of its debug lines in `daemon.log`
 */
function callsSent(): number {
  const log = path.join(ensureTestSessionDir(), 'daemon.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(SENT_LINE).length - 1 : 0;
}

/**
 * Wait until the daemon has sent `count` script calls to Chrome.
 *
 * @param count - Expected total
 */
async function untilCallsSent(count: number): Promise<void> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (callsSent() < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(callsSent() >= count, `the daemon sent ${callsSent()} script calls, expected ${count}`);
}

/**
 * Run `bdg cdp <method> --params … --json`.
 *
 * @param method - CDP method
 * @param params - Its parameters
 * @param stop - Aborted to send SIGINT
 * @param extra - More arguments
 * @returns The command's result
 */
function cdpCall(
  method: string,
  params: Record<string, unknown>,
  stop?: AbortSignal,
  extra: string[] = []
): Promise<CommandResult> {
  return runCommand('cdp', [method, '--params', JSON.stringify(params), ...extra, '--json'], {
    timeout: COMMAND_TIMEOUT_MS,
    ...(stop && { interrupt: stop }),
  });
}

void describe('Interrupted bdg cdp script call', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}eval-frames`,
      ['--port', String(port), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS, env: { BDG_DEBUG: '1' } }
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

  /** Check that `dom eval 1+1` answers well before the loop would have ended. */
  async function assertAnswersAtOnce(): Promise<void> {
    const startedAt = Date.now();
    const next = await runCommand('dom', ['eval', '1+1'], { timeout: COMMAND_TIMEOUT_MS });
    const ms = Date.now() - startedAt;
    assert.equal(next.exitCode, 0, shown(next));
    assert.equal(next.stdout.trim(), '2', shown(next));
    assert.ok(
      ms < ANSWER_WITHIN_MS,
      `the next eval answered after ${ms} ms (limit ${ANSWER_WITHIN_MS} ms)`
    );
  }

  /**
   * Start a looping call and interrupt it once its script runs.
   *
   * @param tag - Beacon query string
   * @param method - CDP method
   * @param params - Its parameters
   * @param extra - More arguments
   * @returns The interrupted call's result (exit 130, asserted)
   */
  async function interruptLoop(
    tag: string,
    method: string,
    params: Record<string, unknown>,
    extra: string[] = []
  ): Promise<CommandResult> {
    const stop = new AbortController();
    const loop = cdpCall(method, params, stop.signal, extra);
    await untilBeacon(tag);
    stop.abort();
    const interrupted = await loop;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    return interrupted;
  }

  /**
   * `Runtime.evaluate` parameters for a loop.
   *
   * @param tag - Beacon query string
   * @param ms - How long it loops
   * @returns Parameters
   */
  function evaluateLoop(tag: string, ms = LOOP_MS): Record<string, unknown> {
    return { expression: `(() => { ${loopBody(tag, ms)} })()`, returnByValue: true };
  }

  void it('Runtime.evaluate: stops the script so the next command answers at once', async () => {
    await interruptLoop('evaluate-loop', 'Runtime.evaluate', evaluateLoop('evaluate-loop'));
    await assertAnswersAtOnce();
  });

  void it('Runtime.evaluate: says the script was stopped on the page', async () => {
    const result = await interruptLoop(
      'message-loop',
      'Runtime.evaluate',
      evaluateLoop('message-loop')
    );
    const envelope = JSON.parse(result.stdout.trim()) as { suggestion?: string };
    assert.match(
      envelope.suggestion ?? '',
      /stopped on the page if it was still running/,
      shown(result)
    );
    await assertAnswersAtOnce();
  });

  void it('Runtime.callFunctionOn: stops the script so the next command answers at once', async () => {
    const window = await cdpCall('Runtime.evaluate', { expression: 'window' });
    assert.equal(window.exitCode, 0, shown(window));
    const { data } = JSON.parse(window.stdout) as {
      data: { result: { result: { objectId: string } } };
    };
    await interruptLoop('call-loop', 'Runtime.callFunctionOn', {
      objectId: data.result.result.objectId,
      functionDeclaration: `function () { ${loopBody('call-loop', LOOP_MS)} }`,
      returnByValue: true,
    });
    await assertAnswersAtOnce();
  });

  void it('Runtime.evaluate --collect: stops the script so the next command answers at once', async () => {
    await interruptLoop('collect-loop', 'Runtime.evaluate', evaluateLoop('collect-loop'), [
      '--collect',
      'Runtime.consoleAPICalled',
    ]);
    await assertAnswersAtOnce();
  });

  void it("leaves another client's running call alone when a call queued behind it is interrupted", async () => {
    const running = cdpCall('Runtime.evaluate', evaluateLoop('survivor-loop', SHORT_LOOP_MS));
    await untilBeacon('survivor-loop');
    const sentBefore = callsSent();
    const stop = new AbortController();
    const queued = cdpCall('Runtime.evaluate', { expression: '1+1' }, stop.signal);
    await untilCallsSent(sentBefore + 1);
    stop.abort();
    const interrupted = await queued;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    const survivor = await running;
    assert.equal(survivor.exitCode, 0, shown(survivor));
    assert.match(survivor.stdout, /"value":"finished"/, shown(survivor));
  });

  void it('stops an interrupted dom eval behind a replMode call that awaits forever', async () => {
    const sentBefore = callsSent();
    const stopAwaiting = new AbortController();
    const awaiting = cdpCall(
      'Runtime.evaluate',
      { expression: 'await new Promise(() => {})', replMode: true },
      stopAwaiting.signal
    );
    await untilCallsSent(sentBefore + 1);
    const stopLoop = new AbortController();
    const loop = runCommand('dom', ['eval', `(() => { ${loopBody('repl-loop', LOOP_MS)} })()`], {
      timeout: COMMAND_TIMEOUT_MS,
      interrupt: stopLoop.signal,
    });
    await untilBeacon('repl-loop');
    stopLoop.abort();
    const interrupted = await loop;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    await assertAnswersAtOnce();
    stopAwaiting.abort();
    await awaiting;
  });
});
