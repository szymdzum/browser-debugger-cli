/**
 * Type-safe CDP Connection Wrapper
 *
 * Provides compile-time type safety for Chrome DevTools Protocol methods
 * using official TypeScript definitions from devtools-protocol package.
 *
 * Benefits:
 * - Autocomplete for all 300+ CDP methods
 * - Type-checked parameters and return values
 * - Type-safe event handlers
 * - No runtime overhead (types erased at compile time)
 */

import type { CDPConnection } from './cdp.js';
import type Protocol from 'devtools-protocol/types/protocol';
import type ProtocolMapping from 'devtools-protocol/types/protocol-mapping';

/**
 * Extract parameter type from a CDP command.
 *
 * If command has no parameters, returns empty object type.
 * If command has single parameter array, returns first element.
 */
type CommandParams<T extends keyof ProtocolMapping.Commands> =
  ProtocolMapping.Commands[T]['paramsType'] extends [infer P]
    ? P
    : ProtocolMapping.Commands[T]['paramsType'] extends []
      ? Record<string, never>
      : never;

/**
 * Extract return type from a CDP command.
 */
type CommandReturn<T extends keyof ProtocolMapping.Commands> =
  ProtocolMapping.Commands[T]['returnType'];

/**
 * Extract event parameter type from a CDP event.
 *
 * If event has no parameters, returns empty object.
 * If event has single parameter array, returns first element.
 */
type EventParams<T extends keyof ProtocolMapping.Events> = ProtocolMapping.Events[T] extends [
  infer P,
]
  ? P
  : ProtocolMapping.Events[T] extends []
    ? void
    : never;

/**
 * Type-safe wrapper around CDPConnection.
 *
 * Provides strongly-typed methods for sending CDP commands and
 * registering event handlers.
 *
 * @example
 * ```typescript
 * const cdp = new CDPConnection(wsUrl);
 * const typed = new TypedCDPConnection(cdp);
 *
 * // Type-safe command with autocomplete
 * const response = await typed.send('Network.getCookies', { urls: ['http://example.com'] });
 * // response type: Protocol.Network.GetCookiesResponse
 *
 * // Type-safe event handler
 * typed.on('Network.requestWillBeSent', (event) => {
 *   // event type: Protocol.Network.RequestWillBeSentEvent
 *   console.log(event.request.url);
 * });
 * ```
 */
export class TypedCDPConnection {
  constructor(private cdp: CDPConnection) {}

  /**
   * Send a type-safe CDP command.
   *
   * @param method - CDP method name (autocomplete available for 300+ methods)
   * @param params - Command parameters (type-checked)
   * @returns Promise resolving to command response (type-safe)
   *
   * @example
   * ```typescript
   * // Network domain
   * const cookies = await typed.send('Network.getCookies', { urls: ['http://example.com'] });
   *
   * // Runtime domain
   * const result = await typed.send('Runtime.evaluate', {
   *   expression: 'document.title',
   *   returnByValue: true
   * });
   *
   * // DOM domain
   * const doc = await typed.send('DOM.getDocument', {});
   * ```
   */
  async send<T extends keyof ProtocolMapping.Commands>(
    method: T,
    params: CommandParams<T>
  ): Promise<CommandReturn<T>> {
    const result = await this.cdp.send(method, params as Record<string, unknown>);
    return result as CommandReturn<T>;
  }

  /**
   * Register a type-safe event handler.
   *
   * @param event - CDP event name (autocomplete available)
   * @param handler - Event handler with type-safe parameters
   * @returns Handler ID for later removal
   *
   * @example
   * ```typescript
   * // Network events
   * const id = typed.on('Network.requestWillBeSent', (event) => {
   *   console.log(event.request.url, event.request.method);
   * });
   *
   * // Console events
   * typed.on('Runtime.consoleAPICalled', (event) => {
   *   console.log(event.type, event.args);
   * });
   *
   * // Page events
   * typed.on('Page.loadEventFired', (event) => {
   *   console.log('Page loaded at:', event.timestamp);
   * });
   * ```
   */
  on<T extends keyof ProtocolMapping.Events>(
    event: T,
    handler: (params: EventParams<T>) => void
  ): number {
    return this.cdp.on(event, handler as (params: unknown) => void);
  }

  /**
   * Remove an event handler by ID.
   *
   * @param event - CDP event name
   * @param handlerId - Handler ID returned from on()
   *
   * @example
   * ```typescript
   * const id = typed.on('Network.requestWillBeSent', handler);
   * // Later...
   * typed.off('Network.requestWillBeSent', id);
   * ```
   */
  off(event: string, handlerId: number): void {
    this.cdp.off(event, handlerId);
  }

  /**
   * Access underlying CDPConnection for advanced use cases.
   *
   * Use this when you need to call methods not covered by the typed wrapper,
   * or when you need to access connection state/methods directly.
   */
  get raw(): CDPConnection {
    return this.cdp;
  }
}

/**
 * Re-export Protocol namespace for easy access to types.
 *
 * @example
 * ```typescript
 * import { Protocol } from '@/connection/typed-cdp.js';
 *
 * type Cookie = Protocol.Network.Cookie;
 * type Headers = Protocol.Network.Headers;
 * ```
 */
export type { Protocol };
