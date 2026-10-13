/**
 * Async utilities for common patterns.
 */

import { MAX_TIMER_DELAY_MS } from '@/constants.js';

/**
 * Delay execution for a specified duration, ending early when `signal` aborts.
 *
 * @param ms - Milliseconds to delay
 * @param signal - Optional abort signal (the delay resolves, not rejects, on abort)
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** A wait that ran out of time ({@link withTimeout}) */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

/**
 * A timer delay the platform accepts: longer ones (they can come from a
 * client's request) would fire at once.
 *
 * @param ms - Wanted delay in milliseconds
 * @returns `ms`, at most {@link MAX_TIMER_DELAY_MS}
 */
export function capTimerDelay(ms: number): number {
  return Math.min(ms, MAX_TIMER_DELAY_MS);
}

/** Options of {@link raceTimeout} */
export interface RaceTimeoutOptions<R> {
  /** Ends the wait when aborted: rejects with the signal's reason */
  signal?: AbortSignal;
  /** Result (or error, thrown) when time runs out; default: undefined */
  onTimeout?: () => R | Promise<R>;
}

/**
 * Wait for a promise, giving up after a time. The timer is capped
 * ({@link capTimerDelay}) and cleared however the wait ends. Every timer
 * race goes through here; the variants only differ in what a timeout yields
 * (`onTimeout`).
 *
 * @param promise - Work to wait for
 * @param ms - Milliseconds to wait at most
 * @param options - Abort signal and what a timeout yields
 * @returns The promise's result, or what `onTimeout` gives (undefined by default)
 * @throws The signal's reason when aborted, or what `onTimeout` throws
 */
export async function raceTimeout<T, R = undefined>(
  promise: Promise<T>,
  ms: number,
  options: RaceTimeoutOptions<R> = {}
): Promise<T | R> {
  const { signal, onTimeout } = options;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const ended = new Promise<R>((resolve, reject) => {
    timer = setTimeout(() => {
      Promise.resolve()
        .then(() => onTimeout?.() as R | Promise<R>)
        .then(resolve, reject);
    }, capTimerDelay(ms));
    if (!signal) return;
    onAbort = () => reject(signal.reason as Error);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, ended]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Wait for a promise, failing with a {@link TimeoutError} after a time.
 *
 * @param promise - Work to wait for
 * @param ms - Milliseconds to wait at most (at most {@link MAX_TIMER_DELAY_MS})
 * @param label - Operation name for the timeout message
 * @param options - Abort signal
 * @returns The promise's result
 * @throws TimeoutError when the time runs out first
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  return raceTimeout(promise, ms, {
    ...options,
    onTimeout: (): never => {
      throw new TimeoutError(`${label} timeout (${capTimerDelay(ms) / 1000}s)`);
    },
  });
}

/**
 * Poll a condition until it holds or a time runs out.
 *
 * @param condition - Checked first right away, then every `pollMs`
 * @param timeoutMs - Milliseconds to wait at most
 * @param pollMs - Milliseconds between checks
 * @returns True when the condition held, false when the time ran out
 */
export async function waitUntil(
  condition: () => boolean,
  timeoutMs: number,
  pollMs = 25
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) return false;
    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  return true;
}
