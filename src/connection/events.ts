/**
 * CDP Event Source Interface
 *
 * Minimal interface for CDP event handling, decoupling telemetry collectors
 * from CDPConnection implementation details.
 */

/** Cleanup function to unregister an event handler. */
export type EventCleanup = () => void;

/**
 * Minimal interface for subscribing to CDP events.
 *
 * @example
 * ```typescript
 * const cleanup = events.on('Network.requestWillBeSent', (params) => {
 *   console.log('Request:', params.request.url);
 * });
 * cleanup(); // Unregister
 * ```
 */
export interface CDPEventSource {
  /**
   * Register an event handler for a specific CDP event.
   *
   * @param event - CDP event name (e.g., 'Network.requestWillBeSent')
   * @param handler - Function to call when event is received
   * @returns Cleanup function to unregister the handler
   */
  on<T = unknown>(event: string, handler: (params: T) => void): EventCleanup;
}
