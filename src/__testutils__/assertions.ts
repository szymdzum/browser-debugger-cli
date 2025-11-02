/**
 * assertions - Custom assertion helpers for contract tests
 *
 * Provides ergonomic assertions for common test patterns.
 */

import assert from 'node:assert/strict';

import type { CDPMessage } from '@/types.js';

/**
 * Poll a condition until it becomes true or timeout
 * Useful for eventually-consistent assertions
 *
 * @example
 * await assertEventually(() => ws.getSentMessages().length > 0, 1000);
 */
export async function assertEventually(
  fn: () => boolean,
  timeoutMs: number,
  message?: string
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message ?? `Condition not met within ${timeoutMs}ms`);
}

/**
 * Assert deep equality for CDP messages
 * Handles partial matching for convenience
 */
export function assertCDPMessage(actual: CDPMessage, expected: Partial<CDPMessage>): void {
  const actualRecord = actual as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actualRecord[key], value, `CDP message field '${key}' mismatch`);
  }
}

/**
 * Assert that async function throws with specific pattern
 *
 * @example
 * await assertThrowsAsync(
 *   () => cdp.send('Invalid.method'),
 *   /timeout/
 * );
 */
export async function assertThrowsAsync(
  fn: () => Promise<unknown>,
  pattern: RegExp | string,
  message?: string
): Promise<void> {
  try {
    await fn();
    throw new Error(message ?? `Expected function to throw matching ${pattern}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    assert.match(errorMessage, regex, message);
  }
}
