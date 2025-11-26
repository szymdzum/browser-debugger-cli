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
