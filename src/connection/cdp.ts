import WebSocket from 'ws';

import {
  CDP_COMMAND_TIMEOUT_MS,
  CDP_CONNECTION_TIMEOUT_MS,
  CDP_KEEPALIVE_INTERVAL,
  CDP_MAX_CONNECTION_RETRIES,
  CDP_MAX_RECONNECT_ATTEMPTS,
  CDP_BASE_RETRY_DELAY_MS,
  CDP_MAX_RETRY_DELAY_MS,
  CDP_MAX_RECONNECT_DELAY_MS,
  CDP_MAX_MISSED_PONGS,
  CDP_PONG_TIMEOUT_MS,
  WEBSOCKET_NORMAL_CLOSURE,
  WEBSOCKET_NO_PONG_CLOSURE,
  UTF8_ENCODING,
} from '@/constants';
import type { CDPMessage, ConnectionOptions } from '@/types';
import { CDPConnectionError, CDPTimeoutError } from '@/utils/errors.js';

// Error Messages
const CONNECTION_TIMEOUT_ERROR = 'Connection timeout';
const WEBSOCKET_CONNECTION_CLOSED_ERROR = 'WebSocket connection closed';
const CONNECTION_CLOSED_ERROR = 'Connection closed';
const NOT_CONNECTED_BROWSER_ERROR = 'Not connected to browser';
const NOT_CONNECTED_URL_ERROR = 'Not connected - no WebSocket URL available';
const RECONNECTED_SUCCESS_MESSAGE = 'Reconnected successfully';
const CONNECTION_LOST_MESSAGE = 'Connection lost: no pong received';
const PONG_TIMEOUT_MESSAGE = 'Pong timeout - connection may be stale';
const NO_PONG_RECEIVED_REASON = 'No pong received';
const NORMAL_CLOSURE_REASON = 'Normal closure';

// Message Templates
const CONNECTION_ATTEMPT_FAILED_MESSAGE = (attempt: number, delay: number): string =>
  `Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`;
const FAILED_CONNECT_ATTEMPTS_ERROR = (maxRetries: number, lastErrorMessage?: string): string =>
  `Failed to connect after ${maxRetries} attempts: ${lastErrorMessage}`;
const WEBSOCKET_CLOSED_MESSAGE = (code: number, reason: string): string =>
  `WebSocket closed: ${code} - ${reason}`;
const RECONNECTING_MESSAGE = (delay: number, attempt: number, maxAttempts: number): string =>
  `Reconnecting in ${delay}ms... (attempt ${attempt}/${maxAttempts})`;
const UNEXPECTED_DATA_TYPE_ERROR = (dataType: string): string =>
  `Unexpected data type in CDP message: ${dataType}`;
const DATA_CONVERSION_ERROR = (errorMsg: string): string =>
  `Failed to convert message data: ${errorMsg}`;
const JSON_PARSE_ERROR = (errorMsg: string): string => `Failed to parse JSON message: ${errorMsg}`;
const MESSAGE_ROUTING_ERROR = (errorMsg: string): string => `Failed to route message: ${errorMsg}`;

const RECONNECTION_FAILED_ERROR = (errorMsg: string): string => `Reconnection failed: ${errorMsg}`;
const INVALID_WEBSOCKET_URL_ERROR = (url: string, errorMsg: string): string =>
  `Invalid WebSocket URL: ${url}. Error: ${errorMsg}`;
const COMMAND_TIMEOUT_ERROR = (method: string): string => `Command timeout: ${method}`;

/**
 * Chrome DevTools Protocol WebSocket connection manager.
 *
 * Handles bidirectional communication with Chrome via CDP:
 * - Request/response correlation with message IDs
 * - Event subscription and handling
 * - Connection lifecycle (connect, reconnect, keepalive)
 * - Graceful error handling and cleanup
 */

/**
 * Factory function for creating WebSocket instances.
 *
 * Allows dependency injection for testing by providing mock WebSocket
 * implementations while using real WebSocket in production.
 *
 * @param url - WebSocket URL to connect to
 * @returns WebSocket instance
 */
type WebSocketFactory = (url: string) => WebSocket;

export class CDPConnection {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingMessages = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private nextHandlerId = 0;
  private eventHandlers = new Map<string, Map<number, (params: unknown) => void>>();

  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private missedPongs = 0;

  private wsUrl = '';
  private autoReconnect = false;
  private reconnectAttempts = 0;
  private isIntentionallyClosed = false;
  private onReconnect?: (() => Promise<void>) | undefined;
  private connectionOptions: ConnectionOptions = {};
  private readonly createWebSocket: WebSocketFactory;

  constructor(createWebSocket: WebSocketFactory = (url: string) => new WebSocket(url)) {
    this.createWebSocket = createWebSocket;
  }

  /**
   * Connect to Chrome via WebSocket.
   *
   * We retry with exponential backoff because Chrome startup can be slow and
   * network conditions may cause temporary failures. Auto-reconnect defaults
   * to false for CLI tools where connection loss should fail fast rather than
   * continue indefinitely.
   *
   * @param wsUrl - WebSocket debugger URL from CDP target
   * @param options - Connection configuration options
   * @throws Error if connection fails after all retries
   */
  async connect(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const maxRetries = options.maxRetries ?? CDP_MAX_CONNECTION_RETRIES;
    const autoReconnect = options.autoReconnect ?? false;
    const { onReconnect } = options;

    this.wsUrl = wsUrl;
    this.autoReconnect = autoReconnect;
    this.onReconnect = onReconnect;
    this.isIntentionallyClosed = false;
    this.connectionOptions = options;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.attemptConnection(wsUrl, options);
        this.reconnectAttempts = 0;
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = this.calculateBackoffDelay(attempt, CDP_MAX_RETRY_DELAY_MS);
          console.error(CONNECTION_ATTEMPT_FAILED_MESSAGE(attempt, delay));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new CDPConnectionError(
      FAILED_CONNECT_ATTEMPTS_ERROR(maxRetries, lastError?.message),
      lastError
    );
  }

  /**
   * Attempt a single WebSocket connection with timeout.
   *
   * We use a connection timeout because WebSocket connections can hang
   * indefinitely without it, especially in network failure scenarios.
   *
   * @param wsUrl - WebSocket URL to connect to
   * @param options - Connection configuration options
   * @returns Promise that resolves when connection is established
   * @throws CDPTimeoutError if connection times out
   * @throws Error if WebSocket connection fails
   */
  private attemptConnection(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const timeout = options.timeout ?? CDP_CONNECTION_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      this.ws = this.createWebSocket(wsUrl);

      const connectTimeout = setTimeout(() => {
        reject(new CDPTimeoutError(CONNECTION_TIMEOUT_ERROR));
        this.ws?.close();
      }, timeout);

      this.setupWebSocketHandlers(resolve, reject, connectTimeout, options);
    });
  }

  /**
   * Configure WebSocket event handlers for connection lifecycle.
   *
   * We handle close events asynchronously to prevent blocking the WebSocket
   * event loop during cleanup and reconnection attempts.
   *
   * @param resolve - Promise resolve function for successful connection
   * @param reject - Promise reject function for connection failure
   * @param connectTimeout - Timeout handle to clear on success/failure
   * @param options - Connection options for keepalive configuration
   */
  private setupWebSocketHandlers(
    resolve: () => void,
    reject: (error: Error) => void,
    connectTimeout: NodeJS.Timeout,
    options: ConnectionOptions
  ): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      clearTimeout(connectTimeout);
      this.missedPongs = 0;
      this.startKeepalive(options.keepaliveInterval ?? CDP_KEEPALIVE_INTERVAL);
      resolve();
    });

    this.ws.on('error', (error) => {
      clearTimeout(connectTimeout);
      reject(error);
    });

    this.ws.on('close', (code, reason) => {
      void (async () => {
        this.stopKeepalive();

        if (this.isIntentionallyClosed) {
          return;
        }

        console.error(WEBSOCKET_CLOSED_MESSAGE(code, reason.toString()));

        this.clearPendingMessages(new CDPConnectionError(WEBSOCKET_CONNECTION_CLOSED_ERROR));

        if (this.autoReconnect && this.reconnectAttempts < CDP_MAX_RECONNECT_ATTEMPTS) {
          await this.attemptReconnection();
        }
      })();
    });

    this.ws.on('pong', () => {
      this.missedPongs = 0;
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
    });

    this.ws.on('message', (incomingData: WebSocket.RawData) => {
      this.parseIncomingMessage(incomingData);
    });
  }

  /**
   * Parse and route incoming CDP messages.
   *
   * We handle both responses (with ID) and events (with method) in the same
   * message stream. Error handling is liberal to prevent one bad message
   * from breaking the entire connection. Uses separate error handling for
   * conversion, parsing, and routing stages for better debugging.
   *
   * @param incomingData - Raw WebSocket message data to parse
   */
  private parseIncomingMessage(incomingData: WebSocket.RawData): void {
    try {
      const messageText = this.convertRawDataToString(incomingData);
      const message = this.parseJSONMessage(messageText);
      this.routeCDPMessage(message);
    } catch {
      // Error already logged by specific handler, no need to log again
    }
  }

  /**
   * Convert WebSocket raw data to string using appropriate method.
   *
   * Handles all WebSocket data types with a clean conversion strategy.
   * Uses a lookup approach for better maintainability and performance.
   *
   * @param data - Raw WebSocket data to convert
   * @returns Converted string message
   * @throws Error if data type is unsupported
   */
  private convertRawDataToString(data: WebSocket.RawData): string {
    try {
      if (typeof data === 'string') {
        return data;
      }

      if (Buffer.isBuffer(data)) {
        return data.toString(UTF8_ENCODING);
      }

      if (Array.isArray(data)) {
        return Buffer.concat(data).toString(UTF8_ENCODING);
      }

      throw new Error(UNEXPECTED_DATA_TYPE_ERROR(typeof data));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(DATA_CONVERSION_ERROR(errorMsg));
      throw error;
    }
  }

  /**
   * Parse JSON string into CDP message object.
   *
   * Validates basic message structure to ensure we have a valid CDP message
   * before attempting to route it.
   *
   * @param messageText - JSON string to parse
   * @returns Parsed CDP message object
   * @throws Error if JSON is invalid or message structure is malformed
   */
  private parseJSONMessage(messageText: string): CDPMessage {
    try {
      const message = JSON.parse(messageText) as CDPMessage;

      // Basic validation - CDP messages should be objects
      if (typeof message !== 'object' || message === null) {
        throw new Error('CDP message must be an object');
      }

      return message;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(JSON_PARSE_ERROR(errorMsg));
      throw error;
    }
  }

  /**
   * Route CDP message to appropriate handler based on message type.
   *
   * CDP messages are either responses (have ID) or events (have method).
   * Some messages may have both, which is valid and should be handled.
   *
   * @param message - Parsed CDP message to route
   * @throws Error if routing fails
   */
  private routeCDPMessage(message: CDPMessage): void {
    try {
      if (message.id !== undefined) {
        this.handleCDPResponse(message);
      }

      if (message.method) {
        this.handleCDPEvent(message);
      }

      // Log warning if message has neither ID nor method (unusual but not fatal)
      if (message.id === undefined && !message.method) {
        console.warn('Received CDP message with neither ID nor method - ignoring');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(MESSAGE_ROUTING_ERROR(errorMsg));
      throw error;
    }
  }

  /**
   * Handle CDP command responses by resolving pending promises.
   *
   * @param message - CDP message containing response data
   */
  private handleCDPResponse(message: CDPMessage): void {
    if (message.id === undefined) return;

    const pending = this.pendingMessages.get(message.id);
    if (pending) {
      this.pendingMessages.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  /**
   * Handle CDP events by notifying registered handlers.
   *
   * @param message - CDP message containing event data
   */
  private handleCDPEvent(message: CDPMessage): void {
    if (!message.method) return;

    const handlers = this.eventHandlers.get(message.method);
    if (handlers) {
      handlers.forEach((handler) => handler(message.params));
    }
  }

  /**
   * Calculate exponential backoff delay with maximum cap.
   *
   * We use exponential backoff to avoid thundering herd problems when many
   * clients reconnect simultaneously. The maximum cap prevents extremely
   * long delays that would make the tool unusable.
   *
   * @param attempt - Current attempt number (0-based)
   * @param maxDelay - Maximum delay in milliseconds
   * @returns Calculated delay in milliseconds (base delay * 2^attempt, capped at maxDelay)
   */
  private calculateBackoffDelay(attempt: number, maxDelay: number): number {
    return Math.min(CDP_BASE_RETRY_DELAY_MS * Math.pow(2, attempt), maxDelay);
  }

  /**
   * Clear all pending command promises with the given error.
   *
   * We reject pending messages rather than letting them hang indefinitely
   * because callers need to know that their commands failed due to connection
   * loss so they can handle the error appropriately.
   *
   * @param error - Error to reject all pending promises with
   */
  private clearPendingMessages(error: Error): void {
    this.pendingMessages.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(error);
    });
    this.pendingMessages.clear();
  }

  /**
   * Attempt to reconnect to the WebSocket after connection loss.
   *
   * Uses exponential backoff with longer delays than initial connection
   * attempts because reconnection typically indicates more serious issues.
   * Calls the onReconnect callback after successful reconnection to allow
   * callers to re-enable CDP domains or reinitialize state.
   *
   * @throws Never throws - errors are logged but not propagated to avoid
   *         breaking reconnection loops
   */
  private async attemptReconnection(): Promise<void> {
    this.reconnectAttempts++;
    const delay = this.calculateBackoffDelay(
      this.reconnectAttempts - 1,
      CDP_MAX_RECONNECT_DELAY_MS
    );
    console.error(RECONNECTING_MESSAGE(delay, this.reconnectAttempts, CDP_MAX_RECONNECT_ATTEMPTS));

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.attemptConnection(this.wsUrl, this.connectionOptions);
      this.reconnectAttempts = 0;
      console.error(RECONNECTED_SUCCESS_MESSAGE);

      if (this.onReconnect) {
        await this.onReconnect();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(RECONNECTION_FAILED_ERROR(errorMsg));
    }
  }

  /**
   * Start keepalive ping/pong mechanism.
   *
   * We use 3 missed pongs as the threshold because network conditions can
   * cause occasional packet loss, but 3 consecutive failures likely indicates
   * a dead connection that should be terminated rather than waiting longer.
   */
  private startKeepalive(interval: number): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.missedPongs++;

        if (this.missedPongs >= CDP_MAX_MISSED_PONGS) {
          console.error(CONNECTION_LOST_MESSAGE);
          this.ws.close(WEBSOCKET_NO_PONG_CLOSURE, NO_PONG_RECEIVED_REASON);
          return;
        }

        this.ws.ping();

        this.pongTimeout = setTimeout(() => {
          console.error(PONG_TIMEOUT_MESSAGE);
          // Pong timeout is informational - the connection will be closed
          // on the next ping cycle if no pong is received
        }, CDP_PONG_TIMEOUT_MS);
      }
    }, interval);
  }

  private stopKeepalive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Get the CDP port from the WebSocket URL.
   *
   * Used by other modules that need to make HTTP requests to the same
   * Chrome instance (e.g., fetching target list via /json/list endpoint).
   *
   * @returns CDP port number
   * @throws CDPConnectionError if not connected or URL is invalid
   */
  getPort(): number {
    if (!this.wsUrl) {
      throw new CDPConnectionError(NOT_CONNECTED_URL_ERROR);
    }

    try {
      const url = new URL(this.wsUrl);
      return parseInt(url.port, 10);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new CDPConnectionError(INVALID_WEBSOCKET_URL_ERROR(this.wsUrl, errorMsg));
    }
  }

  /**
   * Send a CDP command and wait for the response.
   *
   * Return type is unknown because CDP response structures vary dramatically
   * by method (DOM.getDocument vs Page.navigate vs Runtime.evaluate all return
   * completely different object shapes). Callers must type-assert based on
   * the specific method being called. 30-second timeout balances responsiveness
   * with allowing time for heavy operations like DOM traversal.
   *
   * @param method - CDP method name (e.g., 'Page.navigate', 'DOM.getDocument')
   * @param params - Method parameters
   * @param sessionId - Optional session ID for commands sent to specific targets
   *                      (used when controlling specific frames or workers)
   * @returns Promise resolving to the command result
   * @throws CDPConnectionError if not connected to browser
   * @throws CDPTimeoutError if command times out (30s)
   */
  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new CDPConnectionError(NOT_CONNECTED_BROWSER_ERROR);
    }

    const id = ++this.messageId;
    const message: CDPMessage & { sessionId?: string } = { id, method, params };

    if (sessionId) {
      message.sessionId = sessionId;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(id);
        reject(new CDPTimeoutError(COMMAND_TIMEOUT_ERROR(method)));
      }, CDP_COMMAND_TIMEOUT_MS);

      this.pendingMessages.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });

      // Safe to assert non-null: we checked this.ws exists on line 543
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Register an event handler for CDP events.
   *
   * Type casting is safe because we store handlers as (params: unknown) => void
   * and always invoke them with unknown parameters. The generic T is only for
   * caller convenience and type checking at the call site.
   *
   * @param event - CDP event name (e.g., 'Network.requestWillBeSent')
   * @param handler - Callback function to handle the event
   * @returns Handler ID for later removal with off()
   * @template T - Type of event parameters for type safety at call site
   */
  on<T = unknown>(event: string, handler: (params: T) => void): number {
    let handlersForEvent = this.eventHandlers.get(event);
    if (!handlersForEvent) {
      handlersForEvent = new Map();
      this.eventHandlers.set(event, handlersForEvent);
    }
    const handlerId = ++this.nextHandlerId;
    handlersForEvent.set(handlerId, handler as (params: unknown) => void);
    return handlerId;
  }

  /**
   * Remove a specific event handler.
   *
   * @param event - CDP event name
   * @param handlerId - Handler ID returned from on()
   */
  off(event: string, handlerId: number): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handlerId);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /**
   * Remove all event handlers for a specific event or all events.
   *
   * @param event - Optional event name. If omitted, removes all handlers for all events.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.clear();
    }
  }

  /**
   * Close the WebSocket connection and clean up resources.
   *
   * Performs complete cleanup including stopping keepalive, rejecting pending
   * messages, closing WebSocket, and removing all event handlers.
   *
   * @param code - WebSocket close code (default: 1000 for normal closure)
   * @param reason - Human-readable close reason
   */
  close(code = WEBSOCKET_NORMAL_CLOSURE, reason = NORMAL_CLOSURE_REASON): void {
    this.isIntentionallyClosed = true;
    this.autoReconnect = false;
    this.stopKeepalive();

    this.clearPendingMessages(new CDPConnectionError(CONNECTION_CLOSED_ERROR));

    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }

    this.removeAllListeners();
  }

  /**
   * Check if the WebSocket connection is open and ready.
   *
   * @returns True if connected and ready to send/receive messages
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
