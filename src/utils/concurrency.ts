/**
 * Custom concurrency limiter for controlling parallel async operations.
 *
 * @module utils/concurrency
 */

/**
 * Limits the number of concurrent async operations.
 *
 * @example
 * ```typescript
 * const limiter = new ConcurrencyLimiter(5);
 * const results = await Promise.all(
 *   tasks.map(task => limiter.run(() => performTask(task)))
 * );
 * ```
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  /**
   * Creates a new concurrency limiter.
   *
   * @param limit - Maximum number of concurrent operations
   */
  constructor(private readonly limit: number) {
    if (limit < 1) {
      throw new Error('Concurrency limit must be at least 1');
    }
  }

  /**
   * Executes an async function with concurrency control.
   *
   * @param fn - Async function to execute
   * @returns Promise resolving to the function's result
   *
   * @example
   * ```typescript
   * const limiter = new ConcurrencyLimiter(3);
   * const result = await limiter.run(async () => {
   *   const response = await fetch(url);
   *   return response.json();
   * });
   * ```
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Gets the current number of running operations.
   *
   * @returns Number of currently executing operations
   */
  getRunningCount(): number {
    return this.running;
  }

  /**
   * Gets the current queue size.
   *
   * @returns Number of operations waiting to execute
   */
  getQueueSize(): number {
    return this.queue.length;
  }
}
