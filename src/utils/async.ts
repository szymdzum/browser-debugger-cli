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

/**
 * Wait for a promise, giving up after a time; the timer is cleared either way.
 *
 * @param promise - Work to wait for
 * @param ms - Milliseconds to wait at most
 * @returns The promise's result, or undefined when the time ran out first
 */
export async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
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
