/**
 * An interrupted `bdg dom eval` stops its script on the page (#713).
 *
 * When the CLI that sent an eval exits (Ctrl-C, SIGTERM) while the script
 * still runs, the daemon terminates the script instead of letting it run to
 * its 20 s limit: the next eval answers at once. An eval another CLI sent
 * meanwhile (queued behind the busy script) answers too, never 102 or 130,
 * and interrupting an eval queued behind another client's running script
 * leaves that script alone. An eval the daemon has answered is never
 * stopped: its client exiting after a lost result (Chrome could not send it,
 * the call stays pending) must not stop the script another client runs.
 *
 * Signals are sent once the command is known to be where the test needs
 * it: a looping script has told the fixture server it started (a
 * synchronous `/beacon?…` request before the loop), and a queued eval has
 * been sent to Chrome (the daemon's `dom eval sent` debug line in
 * `daemon.log`, the session runs with `BDG_DEBUG=1`). Times are measured,
 * and commands are awaited, not slept for.
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
const LOOP_MS = 20_000;

/** How long a script that is left to finish keeps the page busy */
const SHORT_LOOP_MS = 3_000;

/**
 * How long a lost result's answer gets after the page answered the check
 * (production: 12 s). It only affects lost-answer timing; the lost-result
 * tests rely on it being well under the 20 s eval limit ({@link LOST_MS}).
 */
const UNSENT_GRACE_MS = '4000';

/**
 * Bound for an eval whose result is lost: about 1 s check + 4 s grace (5 s in),
 * well under the 20 s limit it would fall back to if the lost-result check
 * never fired
 */
const LOST_MS = 12_000;

/**
 * How long another client's script runs while an eval's result is lost: it
 * starts 2 s into that eval and outlasts its answer (about 5 s in)
 */
const OTHER_LOOP_MS = 8_000;

/** Upper bound for every command: well past the loop and the eval's own limit */
const COMMAND_TIMEOUT_MS = 60_000;

/** How fast the page must answer again once the eval was interrupted */
const ANSWER_WITHIN_MS = 3_000;

/** The daemon's debug line for an eval sent to Chrome */
const EVAL_SENT_LINE = 'dom eval sent';

/**
 * A script that tells the fixture server it started, then busy-waits.
 *
 * @param tag - Beacon query string
 * @param ms - How long it loops
 * @returns Script source
 */
function loopScript(tag: string, ms = LOOP_MS): string {
  return `(() => { const r = new XMLHttpRequest(); r.open('GET', '/beacon?${tag}', false); r.send(); const end = Date.now() + ${ms}; while (Date.now() < end); return 'finished'; })()`;
}

/**
 * `--frame` arguments.
 *
 * @param frame - Frame, if any
 * @returns Arguments
 */
function frameArgs(frame: string | undefined): string[] {
  return frame === undefined ? [] : ['--frame', frame];
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
 * How many evals the daemon has sent to Chrome so far.
 *
 * @returns Count of its debug lines in `daemon.log`
 */
function evalsSent(): number {
  const log = path.join(ensureTestSessionDir(), 'daemon.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(EVAL_SENT_LINE).length - 1 : 0;
}

/**
 * Wait until the daemon has sent `count` evals to Chrome.
 *
 * @param count - Expected total
 */
async function untilEvalsSent(count: number): Promise<void> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (evalsSent() < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(evalsSent() >= count, `the daemon sent ${evalsSent()} evals, expected ${count}`);
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
      {
        timeout: COMMAND_TIMEOUT_MS,
        env: { BDG_DEBUG: '1', BDG_TEST_EVAL_UNSENT_GRACE_MS: UNSENT_GRACE_MS },
      }
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
   * Run `dom eval --json`; it is interrupted when `stop` aborts.
   *
   * @param script - Script
   * @param stop - Aborted to send `signal`
   * @param options - `--frame` value, the signal (default SIGINT), more arguments
   * @returns The eval's result
   */
  function startEval(
    script: string,
    stop?: AbortSignal,
    options: { frame?: string; signal?: NodeJS.Signals; extra?: string[] } = {}
  ): Promise<CommandResult> {
    const extra = [...frameArgs(options.frame), ...(options.extra ?? [])];
    return runCommand('dom', ['eval', script, ...extra, '--json'], {
      timeout: COMMAND_TIMEOUT_MS,
      ...(stop && { interrupt: stop }),
      ...(options.signal && { interruptWith: options.signal }),
    });
  }

  /**
   * Start `dom eval 1+1` and wait until the daemon has sent it to Chrome,
   * where it waits behind the running script.
   *
   * @param stop - Aborted to send SIGINT
   * @returns The eval's pending result (wrapped: an async function would wait for it)
   */
  async function queueEval(stop?: AbortSignal): Promise<{ done: Promise<CommandResult> }> {
    const sentBefore = evalsSent();
    const done = startEval('1+1', stop);
    await untilEvalsSent(sentBefore + 1);
    return { done };
  }

  /**
   * Run `dom eval 1+1` and measure how long it took.
   *
   * @param frame - `--frame` value, if any
   * @returns The result and its duration
   */
  async function timedEval(frame?: string): Promise<{ result: CommandResult; ms: number }> {
    const startedAt = Date.now();
    const result = await runCommand('dom', ['eval', '1+1', ...frameArgs(frame)], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    return { result, ms: Date.now() - startedAt };
  }

  /**
   * Check that `dom eval 1+1` answers at once.
   *
   * @param frame - `--frame` value, if any
   */
  async function assertAnswersAtOnce(frame?: string): Promise<void> {
    const next = await timedEval(frame);
    assert.equal(next.result.exitCode, 0, shown(next.result));
    assert.equal(next.result.stdout.trim(), '2', shown(next.result));
    assert.ok(
      next.ms < ANSWER_WITHIN_MS,
      `the next eval answered after ${next.ms} ms (limit ${ANSWER_WITHIN_MS} ms)`
    );
  }

  /**
   * Start a looping eval and interrupt it once its script runs.
   *
   * @param tag - Beacon query string
   * @param options - `--frame` value and the signal (default SIGINT)
   * @returns The interrupted eval's result (exit 130, 143 for SIGTERM, asserted)
   */
  async function interruptLoop(
    tag: string,
    options: { frame?: string; signal?: NodeJS.Signals } = {}
  ): Promise<CommandResult> {
    const stop = new AbortController();
    const loop = startEval(loopScript(tag), stop.signal, options);
    await untilBeacon(tag);
    stop.abort();
    const interrupted = await loop;
    assert.equal(
      interrupted.exitCode,
      options.signal === 'SIGTERM' ? 143 : 130,
      shown(interrupted)
    );
    return interrupted;
  }

  void it('stops the script so the next eval answers at once', async () => {
    await interruptLoop('page-loop');
    await assertAnswersAtOnce();
  });

  void it('says the script was stopped on the page if it was still running', async () => {
    const result = await interruptLoop('message-loop');
    const envelope = JSON.parse(result.stdout.trim()) as { suggestion?: string };
    assert.match(envelope.suggestion ?? '', /stopped on the page if it was still running/);
    assert.match(envelope.suggestion ?? '', /bdg peek/, shown(result));
  });

  void it('stops the script on SIGTERM (143)', async () => {
    await interruptLoop('term-loop', { signal: 'SIGTERM' });
    await assertAnswersAtOnce();
  });

  void it('lets an eval sent meanwhile by another client answer', async () => {
    const stop = new AbortController();
    const loop = startEval(loopScript('parallel-loop'), stop.signal);
    await untilBeacon('parallel-loop');
    const other = (await queueEval()).done;
    const interruptedAt = Date.now();
    stop.abort();
    const [interrupted, answered] = await Promise.all([loop, other]);
    const answeredAfter = Date.now() - interruptedAt;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    assert.equal(answered.exitCode, 0, shown(answered));
    assert.match(answered.stdout, /"result":2/, shown(answered));
    assert.ok(
      answeredAfter < ANSWER_WITHIN_MS,
      `the other eval answered ${answeredAfter} ms after the interrupt (limit ${ANSWER_WITHIN_MS} ms)`
    );
  });

  void it("leaves another client's running script alone when an eval queued behind it is interrupted", async () => {
    const running = startEval(loopScript('survivor-loop', SHORT_LOOP_MS));
    await untilBeacon('survivor-loop');
    const stop = new AbortController();
    const queued = (await queueEval(stop.signal)).done;
    stop.abort();
    const interrupted = await queued;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    const survivor = await running;
    assert.equal(survivor.exitCode, 0, shown(survivor));
    assert.match(survivor.stdout, /"result":"finished"/, shown(survivor));
  });

  void it('answers at once after two interrupts in a row', async () => {
    const stopLoop = new AbortController();
    const loop = startEval(loopScript('double-loop'), stopLoop.signal);
    await untilBeacon('double-loop');
    const stopQueued = new AbortController();
    const queued = (await queueEval(stopQueued.signal)).done;
    stopQueued.abort();
    stopLoop.abort();
    const results = await Promise.all([loop, queued]);
    for (const result of results) assert.equal(result.exitCode, 130, shown(result));
    await assertAnswersAtOnce();
  });

  void it('stops a script in a same-origin iframe (--frame)', async () => {
    await interruptLoop('same-frame-loop', { frame: 'same' });
    await assertAnswersAtOnce('same');
  });

  void it('stops a script in an out-of-process iframe (--frame)', async () => {
    await interruptLoop('cross-frame-loop', { frame: 'cross' });
    await assertAnswersAtOnce('cross');
  });

  for (const full of [false, true]) {
    void it(`never stops another client's script after an eval whose result was lost${full ? ' (--full)' : ''}`, async () => {
      const armed = full ? 'lost-full-armed' : 'lost-armed';
      const lostStartedAt = Date.now();
      const lost = startEval(
        `setTimeout(() => { const r = new XMLHttpRequest(); r.open('GET', '/beacon?${armed}', false); r.send(); }, 2000); 'x'.repeat(300e6)`,
        undefined,
        { extra: full ? ['--full'] : [] }
      );
      await untilBeacon(armed);
      const other = startEval(loopScript(`${armed}-loop`, OTHER_LOOP_MS));
      await untilBeacon(`${armed}-loop`);
      const lostResult = await lost;
      const lostAfter = Date.now() - lostStartedAt;
      assert.ok(lostAfter < LOST_MS, `the lost result took ${lostAfter} ms (limit ${LOST_MS} ms)`);
      assert.equal(lostResult.exitCode, full ? 81 : 102, shown(lostResult));
      const survivor = await other;
      assert.equal(survivor.exitCode, 0, shown(survivor));
      assert.match(survivor.stdout, /"result":"finished"/, shown(survivor));
    });
  }

  void it('stops an interrupted loop at once behind an interrupted eval that awaits a timer (#729)', async () => {
    const stopAwaiting = new AbortController();
    const sentBefore = evalsSent();
    const awaiting = startEval(
      'await new Promise((r) => setTimeout(r, 10000))',
      stopAwaiting.signal
    );
    await untilEvalsSent(sentBefore + 1);
    stopAwaiting.abort();
    assert.equal((await awaiting).exitCode, 130);
    const stopLoop = new AbortController();
    const loop = startEval(loopScript('after-await-loop'), stopLoop.signal);
    await untilBeacon('after-await-loop');
    stopLoop.abort();
    const interrupted = await loop;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    await assertAnswersAtOnce();
  });

  void it("stops a loop with 'await' only in a string while another client's eval waits (#729)", async () => {
    const stop = new AbortController();
    const script = loopScript('string-await-loop').replace("return 'finished'", "return 'await'");
    const loop = startEval(script, stop.signal);
    await untilBeacon('string-await-loop');
    const other = (await queueEval()).done;
    const interruptedAt = Date.now();
    stop.abort();
    const [interrupted, answered] = await Promise.all([loop, other]);
    const answeredAfter = Date.now() - interruptedAt;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    assert.equal(answered.exitCode, 0, shown(answered));
    assert.ok(
      answeredAfter < ANSWER_WITHIN_MS,
      `the other eval answered ${answeredAfter} ms after the interrupt (limit ${ANSWER_WITHIN_MS} ms)`
    );
  });

  void it('stops an interrupted loop that ends in await while another eval waits (#729)', async () => {
    const sentBefore = evalsSent();
    const awaiting = startEval('await new Promise((r) => setTimeout(r, 6000))');
    await untilEvalsSent(sentBefore + 1);
    const stop = new AbortController();
    const script = `const r = new XMLHttpRequest(); r.open('GET', '/beacon?loop-then-await', false); r.send(); const end = Date.now() + ${OTHER_LOOP_MS}; while (Date.now() < end); await 1`;
    const loop = startEval(script, stop.signal);
    await untilBeacon('loop-then-await');
    stop.abort();
    const interrupted = await loop;
    assert.equal(interrupted.exitCode, 130, shown(interrupted));
    await assertAnswersAtOnce();
    assert.equal((await awaiting).exitCode, 0);
  });

  void it('answers status normally afterwards', async () => {
    const status = await runCommand('status', ['--json'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(status.exitCode, 0, shown(status));
  });
});
