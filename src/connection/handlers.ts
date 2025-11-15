import type ProtocolMapping from 'devtools-protocol/types/protocol-mapping';

import type { CDPConnection } from '@/connection/cdp.js';
import type { TypedCDPConnection } from '@/connection/typed-cdp.js';

/**
 * Extract event parameter type from a CDP event.
 */
type EventParams<T extends keyof ProtocolMapping.Events> = ProtocolMapping.Events[T] extends [
  infer P,
]
  ? P
  : ProtocolMapping.Events[T] extends []
    ? void
    : never;

/**
 * Registry for managing CDP event handlers with automatic cleanup.
 *
 * Provides a centralized way to register and clean up CDP event handlers,
 * eliminating the boilerplate code repeated across all telemetry modules.
 *
 * Supports both legacy untyped usage and new type-safe usage with TypedCDPConnection.
 */
export class CDPHandlerRegistry {
  private handlers: Array<{ event: string; id: number }> = [];

  /**
   * Register a CDP event handler and track it for cleanup (legacy API).
   *
   * @param cdp - CDP connection instance
   * @param event - CDP event name (e.g., 'Network.requestWillBeSent')
   * @param handler - Event handler function
   *
   * @deprecated Since v0.5.0. Use registerTyped() with TypedCDPConnection for type safety. Will be removed in v1.0.0.
   */
  register<T>(cdp: CDPConnection, event: string, handler: (params: T) => void): void {
    const id = cdp.on(event, handler);
    this.handlers.push({ event, id });
  }

  /**
   * Register a type-safe CDP event handler and track it for cleanup.
   *
   * @param typed - Typed CDP connection instance
   * @param event - CDP event name (autocomplete available)
   * @param handler - Event handler with type-safe parameters
   *
   * @example
   * ```typescript
   * const registry = new CDPHandlerRegistry();
   * const typed = new TypedCDPConnection(cdp);
   *
   * registry.registerTyped(typed, 'Network.requestWillBeSent', (event) => {
   *   // event is typed as Protocol.Network.RequestWillBeSentEvent
   *   console.log(event.request.url);
   * });
   * ```
   */
  registerTyped<T extends keyof ProtocolMapping.Events>(
    typed: TypedCDPConnection,
    event: T,
    handler: (params: EventParams<T>) => void
  ): void {
    const id = typed.on(event, handler);
    this.handlers.push({ event, id });
  }

  /**
   * Remove all registered event handlers and clear the registry.
   *
   * @param cdp - CDP connection instance (or TypedCDPConnection.raw)
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
