/**
 * testClock - Clock helper wrapper with async/await-friendly API
 *
 * Wraps FakeClock to provide ergonomic async helpers for test code.
 * Use this in tests instead of raw FakeClock for better DX.
 */

import { FakeClock } from './FakeClock.js';

export interface ClockHelper {
  clock: FakeClock;
  tick: (ms: number) => void;
  flush: () => void;
  tickAndFlush: (ms: number) => Promise<void>;
  restore: () => void;
}

/**
 * Create a fake clock for deterministic timer control
 *
 * Usage:
 * ```typescript
 * const { clock, tickAndFlush } = useFakeClock();
 *
 * const promise = cdp.send('Target.getTargets'); // Starts 30s timeout
 * await tickAndFlush(30000); // Advances timer + drains all microtasks
 * await assert.rejects(promise, /timeout/);
 * ```
 */
export function useFakeClock(): ClockHelper {
  const clock = new FakeClock();

  // Store original timer functions
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalQueueMicrotask = global.queueMicrotask;

  // Replace global timers with fake clock
  global.setTimeout = ((callback: () => void, delay: number) => {
    return clock.setTimeout(callback, delay);
  }) as typeof setTimeout;

  global.clearTimeout = ((id: NodeJS.Timeout) => {
    return clock.clearTimer(id);
  }) as typeof clearTimeout;

  global.setInterval = ((callback: () => void, interval: number) => {
    return clock.setInterval(callback, interval);
  }) as typeof setInterval;

  global.clearInterval = ((id: NodeJS.Timeout) => {
    return clock.clearTimer(id);
  }) as typeof clearInterval;

  global.queueMicrotask = (callback: () => void) => {
    clock.queueMicrotask(callback);
  };

  return {
    clock,

    /**
     * Advance time and execute timers (macrotasks only)
     * Does NOT drain microtasks
     */
    tick(ms: number): void {
      clock.tick(ms);
    },

    /**
     * Drain microtask queue completely
     * Loops until queue is empty (handles cascading microtasks)
     */
    flush(): void {
      clock.flush();
    },

    /**
     * Advance time AND drain all microtasks
     * Use this for timeout tests where rejections propagate via microtasks
     */
    async tickAndFlush(ms: number): Promise<void> {
      await clock.tickAsync(ms);
    },

    /**
     * Restore original timer functions
     * IMPORTANT: Call this in afterEach() to avoid polluting other tests
     */
    restore(): void {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
      global.queueMicrotask = originalQueueMicrotask;
      clock.reset();
    },
  };
}
