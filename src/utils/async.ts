/**
 * Async utilities for common patterns.
 */

/**
 * Delay execution for a specified duration.
 *
 * @param ms - Milliseconds to delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
