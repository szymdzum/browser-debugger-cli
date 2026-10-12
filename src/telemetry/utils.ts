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
