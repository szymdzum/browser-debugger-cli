/**
 * Session start order with fake operations: a stop at any step releases
 * exactly what the earlier steps acquired, last first; a full start tears
 * down in the one teardown order.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { acquireSessionResources, type StartOperations } from '@/daemon/session/startSequence.js';
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { ResourceStack } from '@/utils/resourceStack.js';

/** Acquire steps of a launched-Chrome start, in order */
const STEPS = [
  'launchChrome',
  'findPageTarget',
  'connect',
  'restoreState',
  'applyEmulation',
  'startCollectors',
  'startPage',
  'navigate',
  'readReadiness',
] as const;

type Step = (typeof STEPS)[number];

/** The release each step registers, if any */
const RELEASE_OF: Partial<Record<Step, string>> = {
  launchChrome: 'terminateChrome',
  connect: 'closeConnection',
  startCollectors: 'stopCollectors',
  startPage: 'stopPage',
};

/** The teardown order after a full start */
const TEARDOWN = ['stopPage', 'stopCollectors', 'closeConnection', 'terminateChrome'];

const chrome = { pid: 4242 } as LaunchedChrome;
const cdp = { id: 'page' } as unknown as CDPConnection;
const silent = { info: () => {}, debug: () => {} } as unknown as Logger;

interface Fake {
  ops: StartOperations;
  /** Every call, in order */
  calls: string[];
  /** Signals the acquire steps got */
  signals: AbortSignal[];
}

/**
 * Fake operations that record their calls.
 *
 * @param controller - The session's stop controller
 * @param options - Step that stops the start (it aborts and rejects with the reason), external Chrome, failing release
 * @returns The fake
 */
function fakeOperations(
  controller: AbortController,
  options: { stopAt?: Step; external?: boolean; failing?: string } = {}
): Fake {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const step =
    <T>(name: Step, value: T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push(name);
      signals.push(args[args.length - 1] as AbortSignal);
      if (options.stopAt === name) {
        controller.abort(new Error('Session was stopped during startup'));
        return Promise.reject(controller.signal.reason as Error);
      }
      return Promise.resolve(value);
    };
  const release = (name: string) => (): Promise<void> => {
    calls.push(name);
    return name === options.failing
      ? Promise.reject(new Error('release failed'))
      : Promise.resolve();
  };
  const ops: StartOperations = {
    launchChrome: step('launchChrome', options.external ? null : chrome),
    findPageTarget: step('findPageTarget', undefined),
    connect: step('connect', cdp),
    restoreState: step('restoreState', undefined),
    applyEmulation: step('applyEmulation', undefined),
    startCollectors: step('startCollectors', []),
    startPage: step('startPage', undefined),
    navigate: step('navigate', undefined),
    readReadiness: step('readReadiness', undefined),
    terminateChrome: release('terminateChrome'),
    closeConnection: release('closeConnection'),
    stopCollectors: release('stopCollectors'),
    stopPage: release('stopPage'),
  };
  return { ops, calls, signals };
}

/**
 * Run a start, then dispose the stack as `Session.launch` does on failure.
 *
 * @param options - See {@link fakeOperations}
 * @returns Calls made, signals passed, whether the start failed, and the stop signal
 */
async function startThenDispose(
  options: Parameters<typeof fakeOperations>[1] = {}
): Promise<Fake & { failed: boolean; signal: AbortSignal }> {
  const controller = new AbortController();
  const fake = fakeOperations(controller, options);
  const stack = new ResourceStack(silent);
  let failed = false;
  try {
    await acquireSessionResources(stack, controller.signal, fake.ops);
  } catch {
    failed = true;
  }
  await stack.dispose();
  return { ...fake, failed, signal: controller.signal };
}

void describe('acquireSessionResources', () => {
  for (const [index, stopAt] of STEPS.entries()) {
    void it(`a stop at ${stopAt} releases only what the earlier steps acquired, last first`, async () => {
      const { calls, failed } = await startThenDispose({ stopAt });
      const earlier = STEPS.slice(0, index);
      const releases = earlier.flatMap((step) => RELEASE_OF[step] ?? []).reverse();
      assert.equal(failed, true);
      assert.deepEqual(calls, [...earlier, stopAt, ...releases]);
    });
  }

  void it('a full start tears down in the one teardown order', async () => {
    const { calls, failed } = await startThenDispose();
    assert.equal(failed, false);
    assert.deepEqual(calls, [...STEPS, ...TEARDOWN]);
  });

  void it('passes the stop signal to every acquire step', async () => {
    const { signals, signal } = await startThenDispose();
    assert.equal(signals.length, STEPS.length);
    for (const passed of signals) assert.equal(passed, signal);
  });

  void it('an attached Chrome skips the target lookup and is not terminated', async () => {
    const { calls } = await startThenDispose({ external: true });
    const acquired = STEPS.filter((step) => step !== 'findPageTarget');
    assert.deepEqual(calls, [...acquired, 'stopPage', 'stopCollectors', 'closeConnection']);
  });

  void it('a failing release does not skip the later ones', async () => {
    const { calls } = await startThenDispose({ failing: 'stopCollectors' });
    assert.deepEqual(calls.slice(STEPS.length), TEARDOWN);
  });
});
