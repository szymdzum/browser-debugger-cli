/**
 * Shared utilities for telemetry collectors
 */

import { ConcurrencyLimiter } from '@/utils/concurrency.js';

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

/**
 * Default concurrency limit for batch CDP operations.
 * Prevents overwhelming the CDP connection with too many simultaneous requests.
 */
const DEFAULT_CDP_CONCURRENCY = 10;

/**
 * Result of a batch CDP operation.
 */
export interface BatchCDPResult<T> {
  /** Successfully resolved results */
  results: T[];
  /** Errors that occurred during execution */
  errors: Array<{ index: number; error: Error }>;
}

/**
 * Execute multiple CDP operations in parallel with concurrency control.
 *
 * Processes an array of async operations with a maximum concurrency limit,
 * preventing overwhelming of the CDP connection. Collects both successful
 * results and errors, allowing partial success handling.
 *
 * @param operations - Array of async operations to execute
 * @param concurrency - Maximum number of concurrent operations (default: 10)
 * @returns Object containing successful results and errors with their indices
 *
 * @example
 * ```typescript
 * const operations = nodeIds.map(id => () => cdp.send('DOM.describeNode', { nodeId: id }));
 * const { results, errors } = await batchCDPOperations(operations, 5);
 *
 * if (errors.length > 0) {
 *   log.debug(`Failed to describe ${errors.length} nodes`);
 * }
 * ```
 */
export async function batchCDPOperations<T>(
  operations: Array<() => Promise<T>>,
  concurrency: number = DEFAULT_CDP_CONCURRENCY
): Promise<BatchCDPResult<T>> {
  const limiter = new ConcurrencyLimiter(concurrency);
  const results: T[] = [];
  const errors: Array<{ index: number; error: Error }> = [];

  await Promise.all(
    operations.map((operation, index) =>
      limiter.run(async () => {
        try {
          const result = await operation();
          results.push(result);
        } catch (error) {
          errors.push({
            index,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      })
    )
  );

  return { results, errors };
}

/**
 * Process an array in parallel with concurrency control and transformation.
 *
 * Similar to `Promise.all(array.map(fn))` but with concurrency limiting and
 * error collection. Useful for processing large arrays of data that require
 * async operations without blocking the entire event loop.
 *
 * @param items - Array of items to process
 * @param mapper - Async function to transform each item
 * @param concurrency - Maximum number of concurrent operations (default: 10)
 * @returns Object containing successful results and errors with their indices
 *
 * @example
 * ```typescript
 * const requestIds = ['req1', 'req2', 'req3'];
 * const { results, errors } = await parallelMap(
 *   requestIds,
 *   async (id) => cdp.send('Network.getResponseBody', { requestId: id }),
 *   5
 * );
 * ```
 */
export async function parallelMap<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number = DEFAULT_CDP_CONCURRENCY
): Promise<BatchCDPResult<R>> {
  const operations = items.map((item, index) => () => mapper(item, index));
  return batchCDPOperations(operations, concurrency);
}
