/**
 * A LIFO stack of resource releases (the idea of a scope: what is acquired
 * registers how to release it, and disposing releases everything in reverse).
 */

import type { Logger } from '@/ui/logging/index.js';

/** Releases one resource; may be async */
export type Release = () => void | Promise<void>;

/**
 * Releases of the resources acquired so far, run last-in first-out.
 */
export class ResourceStack {
  constructor(private readonly log: Logger) {}

  /**
   * Register the release of a resource just acquired.
   *
   * @param _release - Releases it
   * @param _label - Name of the resource, for the debug log
   */
  defer(_release: Release, _label: string): void {}

  /**
   * Run one acquire step under an abort signal.
   *
   * @param _label - Name of the resource, for the debug log
   * @param _signal - Ends the start
   * @param acquire - Acquires the resource
   * @param _release - Releases what `acquire` returned
   * @returns What `acquire` returned
   */
  async acquire<T>(
    _label: string,
    _signal: AbortSignal,
    acquire: (signal: AbortSignal) => Promise<T>,
    _release?: (value: T) => void | Promise<void>
  ): Promise<T> {
    return acquire(_signal);
  }

  /**
   * Release everything registered, last first.
   */
  async dispose(): Promise<void> {
    this.log.debug('not implemented');
  }
}
