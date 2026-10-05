/**
 * A failed start waits (bounded) for the daemons it spawned to exit, so a
 * command run right after it does not see the session as still starting;
 * only after a failure the daemon reported (it is then exiting), never after
 * a timeout or a successful start.
 *
 * The start runs through {@link attemptStart} with the daemon replaced.
 * Timing bounds are generous: "no wait" means well under the configured wait.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionStartOptions } from '@/commands/shared/optionTypes.js';
import {
  afterSpawnedDaemonExit,
  attemptStart,
  type StartDeps,
  type StartOutcome,
} from '@/commands/shared/startHelpers.js';
import type { SpawnedDaemon } from '@/daemon/launcher.js';
import { IPCErrorCode } from '@/ipc/session/errors.js';
import type { StartSessionResponse } from '@/ipc/session/lifecycle.js';
import { IPCTimeoutError } from '@/ipc/transport/index.js';
import { waitUntil } from '@/utils/async.js';

/** Longer than any test may take; a test that waits this long fails on the bound */
const LONG_WAIT_MS = 10_000;

/** Elapsed time well below {@link LONG_WAIT_MS}, so "did not wait" holds on slow machines */
const NO_WAIT_BOUND_MS = 3_000;

/**
 * A spawned daemon that exits after a while (or never).
 *
 * @param exitAfterMs - Milliseconds until it exits (`Infinity`: never; 0: already)
 * @param pid - Its PID
 * @returns Fake daemon
 */
function daemon(exitAfterMs: number, pid = 4242): SpawnedDaemon {
  const exitsAt = Date.now() + exitAfterMs;
  return { pid, hasExited: () => Date.now() >= exitsAt };
}

/**
 * Start dependencies with a fake daemon.
 *
 * @param spawned - What `launch` returns (undefined: a daemon was already running)
 * @param send - Fake request
 * @param exitWaitMs - Wait for exiting daemons
 * @returns Dependencies
 */
function deps(
  spawned: SpawnedDaemon | undefined,
  send: () => Promise<StartSessionResponse>,
  exitWaitMs = LONG_WAIT_MS
): StartDeps {
  return { launch: () => Promise.resolve(spawned), send, exitWaitMs };
}

const OK_RESPONSE: StartSessionResponse = {
  type: 'start_session_response',
  sessionId: 's',
  status: 'ok',
  data: { daemonPid: 1, chromePid: 2, port: 9222, targetUrl: 'http://a.test/' },
};

const REFUSED_RESPONSE: StartSessionResponse = {
  type: 'start_session_response',
  sessionId: 's',
  status: 'error',
  message: 'Chrome at 9222 was launched by bdg session "smoke-a"',
  errorCode: IPCErrorCode.CHROME_LAUNCH_FAILED,
  exitCode: 90,
};

const OPTIONS: SessionStartOptions = {
  port: undefined,
  timeout: undefined,
  userDataDir: undefined,
  includeAll: false,
  maxBodySize: undefined,
  headless: true,
  chromeWsUrl: undefined,
  quiet: true,
  chromeFlags: undefined,
};

/**
 * Run a start and time it.
 *
 * @param startDeps - Fake daemon
 * @returns Outcome and elapsed milliseconds
 */
async function timedStart(startDeps: StartDeps): Promise<{ outcome: StartOutcome; ms: number }> {
  const started = Date.now();
  const outcome = await attemptStart('http://a.test/', OPTIONS, [], startDeps);
  return { outcome, ms: Date.now() - started };
}

void describe('attemptStart', () => {
  void it('does not wait after a successful start', async () => {
    const { outcome, ms } = await timedStart(
      deps(daemon(Infinity), () => Promise.resolve(OK_RESPONSE))
    );
    assert.equal(outcome.ok, true);
    assert.ok(ms < NO_WAIT_BOUND_MS, `took ${ms} ms`);
  });

  void it('does not wait when the daemon was already running (none spawned)', async () => {
    const { outcome, ms } = await timedStart(
      deps(undefined, () => Promise.resolve(REFUSED_RESPONSE))
    );
    assert.equal(outcome.ok, false);
    assert.ok(ms < NO_WAIT_BOUND_MS, `took ${ms} ms`);
    if (!outcome.ok) assert.equal(outcome.details?.['daemonStillRunning'], undefined);
  });

  void it('neither waits nor hints after an IPC timeout (the daemon may still be starting)', async () => {
    const { outcome, ms } = await timedStart(
      deps(daemon(Infinity), () => Promise.reject(new IPCTimeoutError('start_session', 1000)))
    );
    assert.ok(ms < NO_WAIT_BOUND_MS, `took ${ms} ms`);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.details?.['daemonStillRunning'], undefined);
    assert.doesNotMatch(outcome.human, /still shutting down/);
  });

  void it('neither waits nor hints after an unexpected error', async () => {
    const { outcome, ms } = await timedStart(
      deps(daemon(Infinity), () => Promise.reject(new Error('boom')))
    );
    assert.ok(ms < NO_WAIT_BOUND_MS, `took ${ms} ms`);
    if (!outcome.ok) assert.doesNotMatch(outcome.human, /still shutting down/);
  });

  void it('waits for the spawned daemon to exit after a refusal it reported', async () => {
    const spawned = daemon(100);
    const { outcome } = await timedStart(deps(spawned, () => Promise.resolve(REFUSED_RESPONSE)));
    assert.equal(spawned.hasExited(), true, 'returned only after the daemon exited');
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.exitCode, 90);
    assert.equal(outcome.details?.['daemonStillRunning'], undefined);
    assert.equal('spawned' in outcome, false);
  });

  void it('returns at once when the daemon has already exited', async () => {
    const { outcome, ms } = await timedStart(
      deps(daemon(0), () => Promise.resolve(REFUSED_RESPONSE))
    );
    assert.ok(ms < NO_WAIT_BOUND_MS, `took ${ms} ms`);
    if (!outcome.ok) assert.equal(outcome.details?.['daemonStillRunning'], undefined);
  });

  void it('reports a daemon still running after the wait, with its PID and a suggestion', async () => {
    const { outcome } = await timedStart(
      deps(daemon(Infinity, 77), () => Promise.resolve(REFUSED_RESPONSE), 50)
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.exitCode, 90);
    assert.equal(outcome.details?.['daemonStillRunning'], true);
    assert.equal(outcome.details?.['daemonPid'], 77);
    assert.match(String(outcome.details?.['suggestion']), /bdg cleanup --force/);
    assert.match(
      outcome.human,
      /PID 77\) was still shutting down after 0\.05s; check with bdg sessions/
    );
  });
});

void describe('afterSpawnedDaemonExit', () => {
  const failure: StartOutcome = { ok: false, error: 'x', human: 'Error: x', exitCode: 90 };

  void it('waits for every daemon the attempts spawned', async () => {
    const first = daemon(50, 1);
    const second = daemon(150, 2);
    const outcome = await afterSpawnedDaemonExit(failure, [first, second], LONG_WAIT_MS);
    assert.equal(first.hasExited() && second.hasExited(), true);
    assert.deepEqual(outcome, failure);
  });

  void it('names a daemon still running and keeps an earlier suggestion', async () => {
    const outcome = await afterSpawnedDaemonExit(
      { ...failure, details: { suggestion: 'Stop the other session' } },
      [daemon(0, 1), daemon(Infinity, 2)],
      30
    );
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.details?.['daemonPid'], 2);
    assert.match(String(outcome.details?.['suggestion']), /^Stop the other session; check with/);
  });
});

void describe('waitUntil', () => {
  void it('returns true as soon as the condition holds', async () => {
    let checks = 0;
    assert.equal(await waitUntil(() => ++checks >= 3, LONG_WAIT_MS, 5), true);
    assert.equal(checks, 3);
  });

  void it('returns false once the time runs out', async () => {
    assert.equal(await waitUntil(() => false, 30, 5), false);
  });
});
