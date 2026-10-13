/**
 * Async utilities for common patterns.
 */

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
  throw new Error(`not implemented: ${String(ms)}`);
}

/** Options of {@link raceTimeout} */
export interface RaceTimeoutOptions<R> {
  /** Ends the wait when aborted: rejects with the signal's reason */
  signal?: AbortSignal;
  /** Result (or error, thrown) when time runs out; default: undefined */
  onTimeout?: () => R | Promise<R>;
}

/**
 * Wait for a promise, giving up after a time; the timer is cleared either way.
 *
 * @param promise - Work to wait for
 * @param ms - Milliseconds to wait at most
 * @param options - Abort signal and what a timeout yields
 * @returns The promise's result, or undefined when the time ran out first
 */
export async function raceTimeout<T, R = undefined>(
  promise: Promise<T>,
  ms: number,
  options: RaceTimeoutOptions<R> = {}
): Promise<T | R | undefined> {
  void options;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait for a promise, failing with a {@link TimeoutError} after a time.
 *
 * @param promise - Work to wait for
 * @param ms - Milliseconds to wait at most
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
  void promise;
  void options;
  throw new Error(`not implemented: ${label} ${String(ms)}`);
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
