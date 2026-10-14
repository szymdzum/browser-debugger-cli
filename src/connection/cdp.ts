import WebSocket from 'ws';

import type { CDPEventSource, EventCleanup } from './events.js';
import type {
  CDPMessage,
  ConnectionLossCause,
  ConnectionOptions,
  CreateOptions,
  Logger,
} from './types.js';

import { delay as asyncDelay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

import { DEFAULT_CDP_CONFIG, WEBSOCKET_CONFIG, UTF8_ENCODING } from './config.js';
import { CDPConnectionError, CDPProtocolError, CDPTimeoutError } from './errors.js';

const CONNECTION_TIMEOUT_ERROR = 'Connection timeout';
const WEBSOCKET_CONNECTION_CLOSED_ERROR = 'WebSocket connection closed';
const CONNECTION_CLOSED_ERROR = 'Connection closed';
const NOT_CONNECTED_BROWSER_ERROR = 'Not connected to browser';
const NOT_CONNECTED_URL_ERROR = 'Not connected - no WebSocket URL available';
const CONNECTION_LOST_MESSAGE = (missed: number): string =>
  `Connection lost: no pong for ${missed} pings; terminating the socket`;
const NORMAL_CLOSURE_REASON = 'Normal closure';
/** ws error code for a message over `maxPayload` */
const MESSAGE_TOO_LARGE_CODE = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';

const CONNECTION_ATTEMPT_FAILED_MESSAGE = (attempt: number, delay: number): string =>
  `Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`;
const CONNECTION_ABORTED_ERROR = 'Connection attempts aborted';
/** Prefix of the browser's download events, the only browser-level events handlers get with a default page session */
const BROWSER_DOWNLOAD_EVENT = 'Browser.download';
/** How long a detached page session waits for the browser to say whether its tab still exists */
const TAB_CHECK_TIMEOUT_MS = 2000;

const FAILED_CONNECT_ATTEMPTS_ERROR = (maxRetries: number, lastErrorMessage?: string): string =>
  `Failed to connect after ${maxRetries} attempts: ${lastErrorMessage}`;
const WEBSOCKET_CLOSED_MESSAGE = (code: number, reason: string): string =>
  `WebSocket closed: ${code} - ${reason}`;
const SOCKET_ERROR_MESSAGE = (errorMsg: string): string => `WebSocket error: ${errorMsg}`;
const UNEXPECTED_DATA_TYPE_ERROR = 'Unexpected data type in CDP message: not a Buffer';
/** Start of a response text: Chrome writes the command id first (`{"id":7,`) */
const UNPARSABLE_RESPONSE_ID = /^\s*\{\s*"id"\s*:\s*(\d+)\s*[,}]/;

/** Error text of a command whose response could not be parsed */
const UNPARSABLE_RESPONSE_ERROR = 'CDP response could not be parsed';

/**
 * What can be said about an unparsable response without quoting it: V8's
 * parse error quotes the text around the bad token, which may hold cookies,
 * bodies or storage values.
 *
 * @param cause - The parse error
 * @param messageText - Raw text of the response
 * @returns Length of the text and the error position, if known
 */
function describeParseFailure(cause: unknown, messageText: string): string {
  const position = /position (\d+)/.exec(getErrorMessage(cause))?.[1];
  return `${messageText.length} chars${position === undefined ? '' : `, error at position ${position}`}`;
}

const NO_ID_OR_METHOD_MESSAGE = 'Received CDP message with neither ID nor method - ignoring';
const INVALID_WEBSOCKET_URL_ERROR = (url: string, errorMsg: string): string =>
  `Invalid WebSocket URL: ${url}. Error: ${errorMsg}`;

/**
 * Chrome DevTools Protocol WebSocket connection manager.
 *
 * Handles bidirectional communication with Chrome via CDP:
 * - Request/response correlation with message IDs
 * - Event subscription and handling
 * - Connection lifecycle (connect, keepalive, loss cause)
 * - Graceful error handling and cleanup
 */

/**
 * Factory function for creating WebSocket instances.
 *
 * Allows dependency injection for testing by providing mock WebSocket
 * implementations while using real WebSocket in production.
 *
 * @param url - WebSocket URL to connect to
 * @param options - WebSocket client options
 * @returns WebSocket instance
 */
type WebSocketFactory = (url: string, options?: WebSocket.ClientOptions) => WebSocket;

export class CDPConnection implements CDPEventSource {
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
  private eventHandlers = new Map<
    string,
    Map<number, (params: unknown, sessionId?: string) => void>
  >();

  private pingInterval: NodeJS.Timeout | null = null;
  private missedPongs = 0;

  private wsUrl = '';
  /** Page session that commands and events without a session id belong to (`bdg attach`) */
  private defaultSessionId: string | undefined;
  private detachedPageSession = false;
  private isIntentionallyClosed = false;
  private lostBecause: ConnectionLossCause | undefined;
  private onDisconnect?: ((code: number, reason: string) => void | Promise<void>) | undefined;
  private readonly createWebSocket: WebSocketFactory;
  private readonly logger: Logger;
  private readonly config = DEFAULT_CDP_CONFIG;

  constructor(
    logger: Logger = console,
    createWebSocket: WebSocketFactory = (url: string, options?: WebSocket.ClientOptions) =>
      new WebSocket(url, options)
  ) {
    this.logger = logger;
    this.createWebSocket = createWebSocket;
  }

  /**
   * Create and connect a CDPConnection instance in one step.
   *
   * Factory method that prevents partially-initialized instances by ensuring
   * the connection is established before returning the instance.
   *
   * @param wsUrl - WebSocket debugger URL from CDP target
   * @param options - Connection and logger configuration options
   * @returns Fully connected CDPConnection instance
   * @throws Error if connection fails after all retries
   *
   * @example
   * ```typescript
   * // Basic usage
   * const cdp = await CDPConnection.create(wsUrl);
   *
   * // With options
   * const cdp = await CDPConnection.create(wsUrl, {
   *   timeout: 10000,
   *   logger: customLogger
   * });
   *
   * // Traditional pattern (still supported)
   * const cdp = new CDPConnection(logger);
   * await cdp.connect(wsUrl, options);
   * ```
   */
  static async create(wsUrl: string, options?: CreateOptions): Promise<CDPConnection> {
    const { logger, ...connectionOptions } = options ?? {};
    const connection = new CDPConnection(logger);
    await connection.connect(wsUrl, connectionOptions);
    return connection;
  }

  /**
   * Connect to Chrome via WebSocket.
   *
   * We retry with exponential backoff because Chrome startup can be slow and
   * network conditions may cause temporary failures. A connection lost once
   * open is not reopened: `onDisconnect` is called and the caller decides.
   *
   * @param wsUrl - WebSocket debugger URL from CDP target
   * @param options - Connection configuration options (`signal` stops retrying)
   * @throws Error if connection fails after all retries or is aborted
   */
  async connect(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const maxRetries = options.maxRetries ?? this.config.maxConnectionRetries;

    this.wsUrl = wsUrl;
    this.onDisconnect = options.onDisconnect;
    this.isIntentionallyClosed = false;
    this.lostBecause = undefined;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries && !options.signal?.aborted; attempt++) {
      try {
        await this.attemptConnection(wsUrl, options);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = this.calculateBackoffDelay(attempt, this.config.maxRetryDelay);
          this.logger.info(CONNECTION_ATTEMPT_FAILED_MESSAGE(attempt, delay));
          await asyncDelay(delay, options.signal);
        }
      }
    }

    if (options.signal?.aborted) {
      throw new CDPConnectionError(CONNECTION_ABORTED_ERROR, lastError);
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
   * @param options - Connection configuration options (`signal` ends a pending attempt)
   * @returns Promise that resolves when connection is established
   * @throws CDPTimeoutError if connection times out
   * @throws CDPConnectionError if the attempt is aborted
   * @throws Error if WebSocket connection fails
   */
  private attemptConnection(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const timeout = options.timeout ?? this.config.connectionTimeout;

    return new Promise((resolve, reject) => {
      this.ws = this.createWebSocket(wsUrl, {
        perMessageDeflate: false,
        handshakeTimeout: WEBSOCKET_CONFIG.handshakeTimeout,
        maxPayload: WEBSOCKET_CONFIG.maxPayload,
      });

      const { signal } = options;
      const onAbort = (): void => {
        clearTimeout(connectTimeout);
        reject(new CDPConnectionError(CONNECTION_ABORTED_ERROR));
        this.ws?.close();
      };
      const settled = (): void => signal?.removeEventListener('abort', onAbort);
      const connectTimeout = setTimeout(() => {
        settled();
        reject(new CDPTimeoutError(CONNECTION_TIMEOUT_ERROR));
        this.ws?.close();
      }, timeout);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.setupWebSocketHandlers(
        () => {
          settled();
          resolve();
        },
        (error) => {
          settled();
          reject(error);
        },
        connectTimeout,
        options
      );
    });
  }

  /**
   * Configure WebSocket event handlers for connection lifecycle.
   *
   * A socket that never opened is a failed attempt, not a disconnect:
   * `connect()` retries it, so it must not trigger `onDisconnect`. An error on
   * an open socket (ws closes it right after) is logged and kept as the loss
   * cause, read through `lossCause` by `onDisconnect`.
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
    let opened = false;

    this.ws.on('open', () => {
      opened = true;
      clearTimeout(connectTimeout);
      this.missedPongs = 0;
      this.startKeepalive(options.keepaliveInterval ?? this.config.keepaliveInterval);
      resolve();
    });

    this.ws.on('error', (error: Error & { code?: string }) => {
      clearTimeout(connectTimeout);
      if (!opened) {
        reject(error);
        return;
      }
      this.logger.info(SOCKET_ERROR_MESSAGE(getErrorMessage(error)));
      this.lostBecause ??=
        error.code === MESSAGE_TOO_LARGE_CODE ? 'message-too-large' : 'socket-error';
    });

    this.ws.on('close', (code, reason) => {
      this.stopKeepalive();
      if (this.isIntentionallyClosed || !opened) return;
      this.logger.info(WEBSOCKET_CLOSED_MESSAGE(code, reason.toString()));
      this.clearPendingMessages(new CDPConnectionError(WEBSOCKET_CONNECTION_CLOSED_ERROR));
      if (this.onDisconnect) {
        void Promise.resolve(this.onDisconnect(code, reason.toString())).catch((error) => {
          this.logger.info(`[cdp] onDisconnect callback error: ${getErrorMessage(error)}`);
        });
      }
    });

    this.ws.on('ping', () => {
      this.logger.debug('Received ping from Chrome');
    });

    this.ws.on('pong', () => {
      this.missedPongs = 0;
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
    let messageText: string | undefined;
    try {
      messageText = this.convertRawDataToString(incomingData);
      const message = this.parseJSONMessage(messageText);
      this.routeCDPMessage(message);
    } catch (error) {
      if (error instanceof SyntaxError && messageText !== undefined) {
        this.logger.debug(
          `Failed to process CDP message: ${describeParseFailure(error, messageText)}`
        );
        this.rejectUnparsableResponse(messageText, error);
        return;
      }
      this.logger.debug(`Failed to process CDP message: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Reject the pending command an unparsable response answers, when its id
   * can be read from the start of the text (Chrome writes `{"id":N,`
   * first), instead of leaving the command to wait out its timeout.
   *
   * @param messageText - Raw text of the response
   * @param cause - Why it could not be parsed
   */
  private rejectUnparsableResponse(messageText: string, cause: unknown): void {
    const id = UNPARSABLE_RESPONSE_ID.exec(messageText)?.[1];
    if (id === undefined) return;
    const pending = this.pendingMessages.get(Number(id));
    if (!pending) return;
    const detail = describeParseFailure(cause, messageText);
    this.logger.info(`CDP response for command ${id} could not be parsed (${detail})`);
    this.pendingMessages.delete(Number(id));
    clearTimeout(pending.timeout);
    pending.reject(new Error(`${UNPARSABLE_RESPONSE_ERROR} (${detail})`));
  }

  /**
   * Convert WebSocket raw data to a string. ws 8 delivers every text message
   * as one Buffer (fragments already joined); `maxPayload` keeps it within
   * Node's longest string.
   *
   * @param data - Raw WebSocket data to convert
   * @returns Message text
   * @throws Error if the data is not a Buffer
   */
  private convertRawDataToString(data: WebSocket.RawData): string {
    if (!Buffer.isBuffer(data)) throw new Error(UNEXPECTED_DATA_TYPE_ERROR);
    return data.toString(UTF8_ENCODING);
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
    const message = JSON.parse(messageText) as CDPMessage;
    if (typeof message !== 'object' || message === null) {
      throw new Error('CDP message must be an object');
    }
    return message;
  }

  /**
   * Route CDP message to appropriate handler based on message type.
   *
   * CDP messages are either responses (have ID) or events (have method).
   * Some messages may have both, which is valid and should be handled.
   *
   * @param message - Parsed CDP message to route
   */
  private routeCDPMessage(message: CDPMessage): void {
    if (message.id !== undefined) {
      this.handleCDPResponse(message);
    }
    if (message.method) {
      this.handleCDPEvent(message);
    }
    if (message.id === undefined && !message.method) {
      this.logger.debug(NO_ID_OR_METHOD_MESSAGE);
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
        const { message: text, code, data } = message.error;
        pending.reject(new CDPProtocolError(text, code, data));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  /**
   * Handle CDP events by notifying registered handlers.
   *
   * Handlers also receive the event's session id, set for events of attached
   * targets (iframes, workers) and absent for the page itself.
   *
   * @param message - CDP message containing event data
   */
  private handleCDPEvent(message: CDPMessage): void {
    if (!message.method) return;
    if (this.defaultSessionId !== undefined && !this.toPageEvent(message)) return;

    const handlers = this.eventHandlers.get(message.method);
    if (handlers) {
      handlers.forEach((handler) => handler(message.params, message.sessionId));
    }
  }

  /**
   * With a default page session: make its events page events (no session
   * id) and keep the browser's own events from handlers, which would take
   * them for the page's, except download events (`Browser.download*`,
   * filtered by frame by their handler). The page session detaching (its tab closed) is
   * handled like a closed page socket.
   *
   * @param message - Event (its session id is removed for the page session)
   * @returns Whether handlers get the event
   */
  private toPageEvent(message: CDPMessage): boolean {
    if (message.sessionId === this.defaultSessionId) {
      delete message.sessionId;
      return true;
    }
    if (message.sessionId !== undefined) return true;
    if (message.method?.startsWith(BROWSER_DOWNLOAD_EVENT)) return true;
    const detached = message.params as { sessionId?: string; targetId?: string } | undefined;
    if (
      message.method === 'Target.detachedFromTarget' &&
      detached?.sessionId === this.defaultSessionId
    ) {
      void this.pageSessionDetached(detached?.targetId);
    }
    return false;
  }

  /**
   * The default page session ended: the connection is of no use to the
   * session any more, so it is closed and reported lost like a page socket
   * Chrome closed. It counts as the tab closing ({@link pageSessionEnded})
   * only when the browser, still answering, no longer lists the tab; a
   * browser shutting down (the socket closes meanwhile, or no answer) is
   * left to the socket's own loss.
   *
   * @param targetId - The tab the session was attached to
   */
  private async pageSessionDetached(targetId: string | undefined): Promise<void> {
    this.logger.info('Page session detached; checking whether the tab still exists');
    const tabGone = await this.tabGone(targetId);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.logger.info(`Page session detached (tab ${tabGone ? 'closed' : 'still listed'})`);
    this.detachedPageSession = tabGone;
    this.isIntentionallyClosed = true;
    this.stopKeepalive();
    this.clearPendingMessages(new CDPConnectionError(WEBSOCKET_CONNECTION_CLOSED_ERROR));
    this.ws?.close();
    this.ws = null;
    if (this.onDisconnect) {
      void Promise.resolve(
        this.onDisconnect(WEBSOCKET_CONFIG.normalClosure, 'Page session detached')
      ).catch((error) =>
        this.logger.info(`[cdp] onDisconnect callback error: ${getErrorMessage(error)}`)
      );
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
    return Math.min(this.config.baseRetryDelay * Math.pow(2, attempt), maxDelay);
  }

  /**
   * Fail every command still waiting for an answer, e.g. after the page's
   * renderer crashed: commands it was running are never answered.
   *
   * @param error - Error the waiting commands fail with
   */
  rejectPending(error: Error): void {
    this.clearPendingMessages(error);
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
   * Start keepalive ping/pong mechanism.
   *
   * We use 3 missed pongs as the threshold because network conditions can
   * cause occasional packet loss, but 3 consecutive failures likely indicates
   * a dead connection. The socket is terminated, not closed: a frozen peer
   * never answers a close frame, and ws would wait 30 s more for it. With
   * the default 30 s interval the loss is noticed 60–90 s after the last pong.
   *
   * @param interval - Milliseconds between pings
   */
  private startKeepalive(interval: number): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.missedPongs++;
      if (this.missedPongs >= this.config.maxMissedPongs) {
        this.logger.info(CONNECTION_LOST_MESSAGE(this.missedPongs));
        this.lostBecause ??= 'no-pong';
        this.ws.terminate();
        return;
      }
      this.ws.ping();
    }, interval);
  }

  /**
   * Stop sending keepalive pings.
   */
  private stopKeepalive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
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
      throw new CDPConnectionError(INVALID_WEBSOCKET_URL_ERROR(this.wsUrl, getErrorMessage(error)));
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
    return this.sendMessage(method, params, sessionId ?? this.defaultSessionId);
  }

  /**
   * Send a command over the socket and wait for its response.
   *
   * @param method - CDP method name
   * @param params - Method parameters
   * @param sessionId - Session the command is for (none: the socket's own target)
   * @returns Promise resolving to the command result
   */
  private sendMessage(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined
  ): Promise<unknown> {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new CDPConnectionError(NOT_CONNECTED_BROWSER_ERROR));
    }

    const id = ++this.messageId;
    const message: CDPMessage = { id, method, params };

    if (sessionId) {
      message.sessionId = sessionId;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(id);
        const timeoutSeconds = this.config.commandTimeout / 1000;
        const errorMessage =
          `Command timeout: ${method}\n\n` +
          `The browser did not respond within ${timeoutSeconds}s.\n\n` +
          `Possible causes:\n` +
          `  - Browser became unresponsive or frozen\n` +
          `  - Heavy page load or JavaScript execution\n` +
          `  - Network issues or slow connection\n` +
          `  - Method requires user interaction\n\n` +
          `Try:\n` +
          `  - Check if page is still loading (look for spinner)\n` +
          `  - Open Chrome DevTools to check for JavaScript errors\n` +
          `  - Reload page and retry: bdg stop && bdg <url>\n` +
          `  - Use simpler CDP method or reduce data size\n` +
          `  - Check Chrome console: chrome://inspect`;
        reject(new CDPTimeoutError(errorMessage));
      }, this.config.commandTimeout);

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

      ws.send(JSON.stringify(message));
    });
  }

  /**
   * Route the connection's commands and events to one attached page: from
   * now on `send()` without a session id goes to that session, and its
   * events reach handlers as the page's own (no session id). For a
   * connection to the browser endpoint (`bdg attach`).
   *
   * @param sessionId - Session id from `Target.attachToTarget({ flatten: true })`
   */
  useDefaultSession(sessionId: string): void {
    this.defaultSessionId = sessionId;
  }

  /**
   * Send a command to the browser itself, past the default page session.
   *
   * @param method - CDP method name
   * @param params - Method parameters
   * @returns The command result
   */
  sendToBrowser(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.sendMessage(method, params, undefined);
  }

  /**
   * Register an event handler for CDP events.
   *
   * Type casting is safe because we store handlers as (params: unknown) \> void
   * and always invoke them with unknown parameters. The generic T is only for
   * caller convenience and type checking at the call site.
   *
   * Implements CDPEventSource interface, returning a cleanup function
   * instead of handler ID for easier resource management.
   *
   * @param event - CDP event name (e.g., 'Network.requestWillBeSent')
   * @param handler - Callback receiving the event params and, for attached targets, their session id
   * @returns Cleanup function to unregister the handler
   * @typeParam T - Type of event parameters for type safety at call site
   *
   * @example
   * ```typescript
   * const cleanup = cdp.on('Network.requestWillBeSent', (params) => {
   *   console.log('Request:', params.request.url);
   * });
   *
   * // Later, unregister
   * cleanup();
   * ```
   */
  on<T = unknown>(event: string, handler: (params: T, sessionId?: string) => void): EventCleanup {
    let handlersForEvent = this.eventHandlers.get(event);
    if (!handlersForEvent) {
      handlersForEvent = new Map();
      this.eventHandlers.set(event, handlersForEvent);
    }
    const handlerId = ++this.nextHandlerId;
    handlersForEvent.set(handlerId, handler as (params: unknown, sessionId?: string) => void);

    return () => this.off(event, handlerId);
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
   * messages, closing WebSocket, and removing all event handlers. Uses graceful
   * close which waits for pending data to be sent.
   *
   * For immediate forceful shutdown (e.g., process termination), use terminate() instead.
   *
   * @param code - WebSocket close code (default: 1000 for normal closure)
   * @param reason - Human-readable close reason
   */
  close(code = WEBSOCKET_CONFIG.normalClosure, reason = NORMAL_CLOSURE_REASON): void {
    this.isIntentionallyClosed = true;
    this.stopKeepalive();

    this.clearPendingMessages(new CDPConnectionError(CONNECTION_CLOSED_ERROR));

    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }

    this.removeAllListeners();
  }

  /**
   * Forcefully terminate the WebSocket connection immediately.
   *
   * Unlike close(), this method does not wait for pending data to be sent
   * and destroys the connection immediately. Use this for emergency shutdown
   * scenarios like process termination (SIGTERM) where waiting for graceful
   * close might cause the process to hang.
   *
   * @example
   * ```typescript
   * // Emergency shutdown on SIGTERM
   * process.on('SIGTERM', () => {
   *   cdp.terminate();
   *   process.exit(0);
   * });
   * ```
   */
  terminate(): void {
    this.isIntentionallyClosed = true;
    this.stopKeepalive();

    this.clearPendingMessages(new CDPConnectionError('Connection terminated'));

    if (this.ws) {
      this.ws.terminate(); // Forceful close
      this.ws = null;
    }

    this.removeAllListeners();
  }

  /**
   * Why the connection was lost, once it was: set before `onDisconnect` runs.
   *
   * @returns The cause, or undefined (open, closed by bdg, or closed by the peer without an error)
   */
  get lossCause(): ConnectionLossCause | undefined {
    return this.lostBecause;
  }

  /**
   * Whether the browser, asked over this connection, no longer lists a tab.
   *
   * @param targetId - The tab
   * @returns False when it is listed, or the browser does not answer within 2 s
   */
  private async tabGone(targetId: string | undefined): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const noAnswer = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), TAB_CHECK_TIMEOUT_MS);
    });
    const listed = this.sendToBrowser('Target.getTargets').then(
      (reply) =>
        !(reply as { targetInfos: { targetId: string }[] }).targetInfos.some(
          (target) => target.targetId === targetId
        ),
      () => false
    );
    try {
      return await Promise.race([listed, noAnswer]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Whether the connection ended because its default page session detached
   * because its tab closed (the browser no longer lists it), not because
   * the socket closed or the browser went away.
   *
   * @returns True after the page session detached
   */
  get pageSessionEnded(): boolean {
    return this.detachedPageSession;
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
