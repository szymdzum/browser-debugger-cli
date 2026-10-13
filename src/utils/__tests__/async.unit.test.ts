/**
 * The shared timer helpers: a wait that times out, whose timer is cleared
 * when the work wins, capped at the longest delay a timer takes, and ended
 * by an abort signal.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { MAX_TIMER_DELAY_MS } from '@/constants.js';
import { type ClockHelper, useFakeClock } from '@/__testutils__/testClock.js';
import { capTimerDelay, delay, raceTimeout, TimeoutError, withTimeout } from '@/utils/async.js';

/** A promise that never settles */
const never = (): Promise<never> => new Promise<never>(() => undefined);

/**
 * Track whether a promise has settled, without awaiting it.
 *
 * @param promise - Promise to watch
 * @returns The settlement state
 */
function watch<T>(promise: Promise<T>): { settled: boolean; value?: T; error?: unknown } {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

/**
 * Advance the fake clock and let the promise chains it settles run (a real
 * macrotask turn: `tickAndFlush` drains one microtask only).
 *
 * @param clock - Fake clock helper
 * @param ms - Milliseconds to advance
 */
async function advance(clock: ClockHelper, ms: number): Promise<void> {
  await clock.tickAndFlush(ms);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

let helper: ClockHelper | undefined;

afterEach(() => {
  helper?.restore();
  helper = undefined;
});

void describe('capTimerDelay', () => {
  void it('keeps a delay a timer takes and caps a longer one', () => {
    assert.equal(capTimerDelay(1000), 1000);
    assert.equal(capTimerDelay(MAX_TIMER_DELAY_MS), MAX_TIMER_DELAY_MS);
    assert.equal(capTimerDelay(MAX_TIMER_DELAY_MS + 1), MAX_TIMER_DELAY_MS);
    assert.equal(capTimerDelay(Number.MAX_SAFE_INTEGER), MAX_TIMER_DELAY_MS);
  });
});

void describe('raceTimeout', () => {
  void it('yields undefined when the time runs out first', async () => {
    helper = useFakeClock();
    const state = watch(raceTimeout(never(), 1000));
    await advance(helper, 999);
    assert.equal(state.settled, false);
    await advance(helper, 1);
    assert.deepEqual([state.settled, state.value], [true, undefined]);
  });

  void it('yields what onTimeout gives, or rejects with what it throws', async () => {
    helper = useFakeClock();
    const given = watch(raceTimeout(never(), 10, { onTimeout: () => 'late' }));
    const thrown = watch(
      raceTimeout(never(), 10, {
        onTimeout: () => {
          throw new Error('too slow');
        },
      })
    );
    await advance(helper, 10);
    assert.equal(given.value, 'late');
    assert.match(String((thrown.error as Error).message), /too slow/);
  });

  void it('clears its timer when the work wins', async () => {
    helper = useFakeClock();
    const result = await raceTimeout(Promise.resolve('done'), 1000);
    assert.equal(result, 'done');
    assert.equal(helper.clock.getPendingTimers(), 0);
  });

  void it('clears its timer when the work fails', async () => {
    helper = useFakeClock();
    await assert.rejects(raceTimeout(Promise.reject(new Error('boom')), 1000), /boom/);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });

  void it('waits the longest delay for a longer one instead of firing at once', async () => {
    helper = useFakeClock();
    const state = watch(raceTimeout(never(), MAX_TIMER_DELAY_MS * 2));
    await advance(helper, MAX_TIMER_DELAY_MS - 1);
    assert.equal(state.settled, false);
    await advance(helper, 1);
    assert.equal(state.settled, true);
  });

  void it('rejects with the reason when aborted, and clears its timer', async () => {
    helper = useFakeClock();
    const controller = new AbortController();
    const state = watch(raceTimeout(never(), 1000, { signal: controller.signal }));
    controller.abort(new Error('interrupted'));
    await advance(helper, 0);
    assert.match(String((state.error as Error | undefined)?.message), /interrupted/);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });

  void it('rejects at once for a signal already aborted', async () => {
    helper = useFakeClock();
    const signal = AbortSignal.abort(new Error('already'));
    const state = watch(raceTimeout(never(), 1000, { signal }));
    await advance(helper, 0);
    assert.match(String((state.error as Error | undefined)?.message), /already/);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });
});

void describe('withTimeout', () => {
  void it('rejects with a TimeoutError naming the operation and the wait', async () => {
    helper = useFakeClock();
    const state = watch(withTimeout(never(), 2000, 'Fetch'));
    await advance(helper, 2000);
    assert.ok(state.error instanceof TimeoutError);
    assert.equal((state.error as Error | undefined)?.message, 'Fetch timeout (2s)');
  });

  void it('names the capped wait for a longer one', async () => {
    helper = useFakeClock();
    const state = watch(withTimeout(never(), MAX_TIMER_DELAY_MS + 5000, 'Fetch'));
    await advance(helper, MAX_TIMER_DELAY_MS);
    assert.equal(
      (state.error as Error | undefined)?.message,
      `Fetch timeout (${MAX_TIMER_DELAY_MS / 1000}s)`
    );
  });

  void it('returns the result and clears its timer when the work wins', async () => {
    helper = useFakeClock();
    assert.equal(await withTimeout(Promise.resolve(7), 1000, 'Fetch'), 7);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });

  void it('passes the work failure on, with its timer cleared', async () => {
    helper = useFakeClock();
    await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000, 'Fetch'), /boom/);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });

  void it('ends at an abort, with its timer cleared', async () => {
    helper = useFakeClock();
    const controller = new AbortController();
    const state = watch(withTimeout(never(), 1000, 'Fetch', { signal: controller.signal }));
    controller.abort(new Error('stop'));
    await advance(helper, 0);
    assert.match(String((state.error as Error | undefined)?.message), /stop/);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });
});

void describe('delay', () => {
  void it('clears its timer when aborted', async () => {
    helper = useFakeClock();
    const controller = new AbortController();
    const state = watch(delay(1000, controller.signal));
    controller.abort();
    await advance(helper, 0);
    assert.equal(state.settled, true);
    assert.equal(helper.clock.getPendingTimers(), 0);
  });
});
