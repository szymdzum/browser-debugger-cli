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
  return { pid, hasExited: () => Date.now() >= exitsAt, stop: () => undefined };
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
  send: StartDeps['send'],
  exitWaitMs = LONG_WAIT_MS
): StartDeps {
  return {
    launch: () => Promise.resolve(spawned),
    send,
    stop: () => Promise.resolve(),
    exitWaitMs,
  };
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

/**
 * A start request the daemon never answers; it fails once the start is
 * interrupted, as the transport does when it closes the connection.
 *
 * @returns Fake request
 */
function sendUntilInterrupted(): StartDeps['send'] {
  return (_url, _options, signal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('start session cancelled')), {
        once: true,
      });
    });
}

const SHUTTING_DOWN_RESPONSE: StartSessionResponse = {
  type: 'start_session_response',
  sessionId: 's',
  status: 'error',
  message: 'The previous session is still shutting down. Try again in a moment.',
  errorCode: IPCErrorCode.SESSION_SHUTTING_DOWN,
};

void describe('attemptStart interrupted (Ctrl-C)', () => {
  void it('reports 130 only after the daemon it spawned has exited', async () => {
    const interrupt = new AbortController();
    const spawned = daemon(Infinity);
    const exited = { at: 0 };
    const pending = attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      deps(spawned, sendUntilInterrupted()),
      interrupt.signal
    );
    setTimeout(() => {
      interrupt.abort('SIGINT');
      setTimeout(() => {
        exited.at = Date.now();
        spawned.hasExited = (): boolean => true;
      }, 100);
    }, 20);

    const outcome = await pending;
    assert.ok(exited.at > 0 && Date.now() >= exited.at, 'returned only after the daemon exited');
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.exitCode, 130);
    assert.match(outcome.human, /Start cancelled \(interrupted\)/);
    assert.equal(outcome.details?.['daemonStillRunning'], undefined);
  });

  void it('reports 143 for SIGTERM, with a hint when the daemon outlives the wait', async () => {
    const interrupt = new AbortController();
    const pending = attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      deps(daemon(Infinity, 77), sendUntilInterrupted(), 50),
      interrupt.signal
    );
    setTimeout(() => interrupt.abort('SIGTERM'), 20);

    const outcome = await pending;
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 143);
    assert.equal(outcome.details?.['daemonStillRunning'], true);
    assert.equal(outcome.details?.['daemonPid'], 77);
  });

  void it('stops retrying at once while the previous session shuts down', async () => {
    const interrupt = new AbortController();
    let sends = 0;
    const started = Date.now();
    const pending = attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      deps(undefined, () => {
        sends++;
        return Promise.resolve(SHUTTING_DOWN_RESPONSE);
      }),
      interrupt.signal
    );
    setTimeout(() => interrupt.abort('SIGINT'), 50);

    const outcome = await pending;
    assert.ok(Date.now() - started < NO_WAIT_BOUND_MS, 'ended within the retry interval');
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 130);
    const sendsAtEnd = sends;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(sends, sendsAtEnd, 'no attempt after the interrupt');
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

/**
 * A spawned daemon that exits once it is told to shut down (or stop is sent).
 *
 * @param pid - Its PID
 * @returns Fake daemon, and how often it was told to shut down
 */
function stoppableDaemon(pid = 4242): SpawnedDaemon & { stops: number } {
  const fake = {
    pid,
    stops: 0,
    hasExited: (): boolean => fake.stops > 0,
    stop: (): void => {
      fake.stops++;
    },
  };
  return fake;
}

void describe('attemptStart interrupted at the edges (#522)', () => {
  void it('Ctrl-C during the spawn tells the daemon it spawned to shut down and waits for it', async () => {
    const interrupt = new AbortController();
    const spawned = stoppableDaemon();
    let sends = 0;
    const outcome = await attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      {
        launch: () => {
          interrupt.abort('SIGINT');
          return Promise.resolve(spawned);
        },
        send: () => {
          sends++;
          return Promise.resolve(OK_RESPONSE);
        },
        stop: () => Promise.resolve(),
        exitWaitMs: LONG_WAIT_MS,
      },
      interrupt.signal
    );
    assert.equal(sends, 0, 'no start request after the interrupt');
    assert.equal(spawned.stops, 1, 'the idle daemon was told to shut down');
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 130);
    assert.equal(outcome.details?.['daemonStillRunning'], undefined);
  });

  void it('Ctrl-C during the spawn reports a daemon that outlives the wait', async () => {
    const interrupt = new AbortController();
    const spawned = daemon(Infinity, 77);
    const outcome = await attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      {
        launch: () => {
          interrupt.abort('SIGTERM');
          return Promise.resolve(spawned);
        },
        send: () => Promise.resolve(OK_RESPONSE),
        stop: () => Promise.resolve(),
        exitWaitMs: 50,
      },
      interrupt.signal
    );
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 143);
    assert.equal(outcome.details?.['daemonPid'], 77);
  });

  void it('Ctrl-C during a failed spawn exits 130 with the failure', async () => {
    const interrupt = new AbortController();
    const outcome = await attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      {
        launch: () => {
          interrupt.abort('SIGINT');
          return Promise.reject(new Error('Daemon exited during startup'));
        },
        send: () => Promise.resolve(OK_RESPONSE),
        stop: () => Promise.resolve(),
        exitWaitMs: LONG_WAIT_MS,
      },
      interrupt.signal
    );
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 130);
    assert.match(outcome.error, /Daemon exited during startup/);
  });

  void it('a first Ctrl-C during the post-failure wait keeps waiting, then exits 130 with the failure', async () => {
    const interrupt = new AbortController();
    const spawned = daemon(Infinity);
    const exited = { at: 0 };
    const pending = attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      deps(spawned, () => {
        setTimeout(() => {
          interrupt.abort('SIGINT');
          setTimeout(() => {
            exited.at = Date.now();
            spawned.hasExited = (): boolean => true;
          }, 100);
        }, 20);
        return Promise.resolve(REFUSED_RESPONSE);
      }),
      interrupt.signal
    );

    const outcome = await pending;
    assert.ok(exited.at > 0, 'returned only after the daemon exited');
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 130);
    assert.equal(outcome.error, REFUSED_RESPONSE.message);
  });

  void it('SIGTERM during the post-failure wait exits 143', async () => {
    const interrupt = new AbortController();
    const outcome = await attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      deps(
        daemon(Infinity),
        () => {
          setTimeout(() => interrupt.abort('SIGTERM'), 10);
          return Promise.resolve(REFUSED_RESPONSE);
        },
        100
      ),
      interrupt.signal
    );
    if (outcome.ok) return assert.fail('expected a failure');
    assert.equal(outcome.exitCode, 143);
    assert.equal(outcome.details?.['daemonStillRunning'], true);
  });

  void it('a start response racing Ctrl-C: the started session is stopped and the start exits 130', async () => {
    const interrupt = new AbortController();
    const spawned = stoppableDaemon();
    let stopRequests = 0;
    const outcome = await attemptStart(
      'http://a.test/',
      OPTIONS,
      [],
      {
        launch: () => Promise.resolve(spawned),
        send: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(OK_RESPONSE);
              interrupt.abort('SIGINT');
            }, 10);
          }),
        stop: () => {
          stopRequests++;
          spawned.stop();
          return Promise.resolve();
        },
        exitWaitMs: LONG_WAIT_MS,
      },
      interrupt.signal
    );
    assert.equal(stopRequests, 1, 'the started session was stopped');
    assert.equal(spawned.hasExited(), true, 'returned only after the daemon exited');
    if (outcome.ok) return assert.fail('expected the start to be cancelled');
    assert.equal(outcome.exitCode, 130);
    assert.match(outcome.human, /Start cancelled \(interrupted\)/);
  });

  void it('a start that succeeded without an interrupt is not stopped', async () => {
    let stopRequests = 0;
    const outcome = await attemptStart('http://a.test/', OPTIONS, [], {
      launch: () => Promise.resolve(stoppableDaemon()),
      send: () => Promise.resolve(OK_RESPONSE),
      stop: () => {
        stopRequests++;
        return Promise.resolve();
      },
      exitWaitMs: LONG_WAIT_MS,
    });
    assert.equal(outcome.ok, true);
    assert.equal(stopRequests, 0);
    assert.equal('spawned' in outcome, false);
  });
});
