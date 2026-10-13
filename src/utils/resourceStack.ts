/**
 * A LIFO stack of resource releases (the idea of a scope: what is acquired
 * registers how to release it, and disposing releases everything in reverse).
 *
 * Plain `try/finally` instead of `await using`: the repo's `lib` (ES2023)
 * has no `AsyncDisposable` types, so tsc rejects `await using`.
 */

import type { Logger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

/** Releases one resource; may be async */
export type Release = () => void | Promise<void>;

/**
 * Releases of the resources acquired so far, run last-in first-out.
 *
 * {@link dispose} may run while an acquire is still in progress (a stop
 * during a start): what that acquire registers later is released by the
 * next `dispose`, or by the running one if it registers before that one
 * finishes.
 */
export class ResourceStack {
  private readonly releases: Array<{ release: Release; label: string }> = [];
  private disposing: Promise<void> = Promise.resolve();

  constructor(private readonly log: Logger) {}

  /**
   * Register the release of a resource just acquired.
   *
   * @param release - Releases it
   * @param label - Name of the resource, for the debug log
   */
  defer(release: Release, label: string): void {
    this.releases.push({ release, label });
  }

  /**
   * Run one acquire step under an abort signal: not started once the signal
   * aborted; what it acquired gets its release registered even when the
   * signal aborted meanwhile, and then the step throws the signal's reason.
   *
   * @param label - Name of the resource, for the debug log
   * @param signal - Ends the start
   * @param acquire - Acquires the resource
   * @param release - Releases what `acquire` returned
   * @returns What `acquire` returned
   * @throws The signal's reason when it aborted before or during the step
   */
  async acquire<T>(
    label: string,
    signal: AbortSignal,
    acquire: (signal: AbortSignal) => Promise<T>,
    release?: (value: T) => void | Promise<void>
  ): Promise<T> {
    signal.throwIfAborted();
    const value = await acquire(signal);
    if (release) this.defer(() => release(value), label);
    signal.throwIfAborted();
    return value;
  }

  /**
   * Release everything registered, last first, each release isolated (a
   * failure is logged and the rest still run). Concurrent and repeated calls
   * queue: each resource is released once. Never rejects.
   *
   * @returns Resolved once the stack is empty
   */
  dispose(): Promise<void> {
    this.disposing = this.disposing.then(() => this.drain());
    return this.disposing;
  }

  /**
   * Pop and run releases until none is left.
   */
  private async drain(): Promise<void> {
    for (let entry = this.releases.pop(); entry; entry = this.releases.pop()) {
      try {
        await entry.release();
      } catch (error) {
        this.log.debug(`Release of ${entry.label} failed: ${getErrorMessage(error)}`);
      }
    }
  }
}
