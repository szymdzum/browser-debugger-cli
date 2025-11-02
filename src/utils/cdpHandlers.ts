import type { CDPConnection } from '@/connection/cdp.js';

/**
 * Registry for managing CDP event handlers with automatic cleanup.
 *
 * Provides a centralized way to register and clean up CDP event handlers,
 * eliminating the boilerplate code repeated across all collectors.
 */
export class CDPHandlerRegistry {
  private handlers: Array<{ event: string; id: number }> = [];

  /**
   * Register a CDP event handler and track it for cleanup.
   *
   * @param cdp - CDP connection instance
   * @param event - CDP event name (e.g., 'Network.requestWillBeSent')
   * @param handler - Event handler function
   */
  register<T>(cdp: CDPConnection, event: string, handler: (params: T) => void): void {
    const id = cdp.on(event, handler);
    this.handlers.push({ event, id });
  }

  /**
   * Remove all registered event handlers and clear the registry.
   *
   * @param cdp - CDP connection instance
   */
  cleanup(cdp: CDPConnection): void {
    this.handlers.forEach(({ event, id }) => cdp.off(event, id));
    this.handlers.length = 0;
  }

  /**
   * Get the number of registered handlers.
   *
   * @returns Number of active handlers
   */
  size(): number {
    return this.handlers.length;
  }
}
