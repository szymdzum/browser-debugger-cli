/**
 * Shared utilities for telemetry collectors
 */

/**
 * Push an item to a bounded buffer with limit enforcement.
 *
 * Prevents unbounded memory growth in long-running sessions by enforcing
 * a maximum buffer size. When the limit is reached, new items are silently
 * dropped and a warning callback is invoked exactly once.
 *
 * @param buffer - Array to push item into
 * @param item - Item to add to buffer
 * @param limit - Maximum buffer size
 * @param onLimitReached - Callback invoked once when limit is first reached
 *
 * @example
 * ```typescript
 * const messages: ConsoleMessage[] = [];
 * const log = createLogger('console');
 *
 * pushWithLimit(
 *   messages,
 *   newMessage,
 *   10_000,
 *   () => log.debug('Console message limit reached (10000)')
 * );
 * ```
 */
const limitReachedBuffers = new WeakSet<unknown[]>();

export function pushWithLimit<T>(
  buffer: T[],
  item: T,
  limit: number,
  onLimitReached: () => void
): void {
  if (buffer.length < limit) {
    buffer.push(item);
    if (buffer.length === limit && !limitReachedBuffers.has(buffer)) {
      limitReachedBuffers.add(buffer);
      onLimitReached();
    }
  }
}

/**
 * Wrap a CDP operation with a timeout to prevent hanging.
 *
 * Prevents telemetry collectors from hanging indefinitely on slow or
 * unresponsive CDP commands. Useful for operations like DOM capture,
 * screenshot capture, or other potentially slow CDP calls.
 *
 * @param promise - CDP operation to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param label - Human-readable label for error messages
 * @returns Promise that resolves with the CDP result or rejects on timeout
 * @throws Error if the operation times out
 *
 * @example
 * ```typescript
 * const doc = await withTimeout(
 *   cdp.send('DOM.getDocument', { depth: -1 }),
 *   5000,
 *   'DOM.getDocument'
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`CDP ${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}
