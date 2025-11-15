/**
 * Connection module type definitions.
 *
 * Contains types specific to Chrome DevTools Protocol connections,
 * Chrome launching, and connection management.
 */

/**
 * Chrome DevTools Protocol message structure.
 *
 * CDP uses a JSON-RPC-like protocol over WebSocket with request/response
 * correlation via message IDs.
 */
export interface CDPMessage {
  /** Message ID for request/response correlation */
  id?: number;
  /** CDP method name (e.g., 'Page.navigate', 'Network.enable') */
  method?: string;
  /** Method parameters */
  params?: Record<string, unknown>;
  /** Method result (present in responses) */
  result?: unknown;
  /** Error information (present in error responses) */
  error?: { code?: number; message: string };
  /** Session ID for commands sent to specific targets */
  sessionId?: string;
}

/**
 * CDP target information from /json/list endpoint.
 */
export interface CDPTarget {
  /** Target ID */
  id: string;
  /** Target type (page, worker, service_worker, etc.) */
  type: string;
  /** Page title */
  title: string;
  /** Page URL */
  url: string;
  /** WebSocket debugger URL for CDP connection */
  webSocketDebuggerUrl: string;
}

/**
 * Optional tuning parameters for CDPConnection.connect.
 */
export interface ConnectionOptions {
  /** Milliseconds to wait for the initial socket open */
  timeout?: number;
  /** Number of connection attempts before failing */
  maxRetries?: number;
  /** Reconnect automatically when the socket closes */
  autoReconnect?: boolean;
  /** Interval between ping frames to keep CDP alive */
  keepaliveInterval?: number;
  /** Async hook invoked after a successful reconnect */
  onReconnect?: (() => Promise<void>) | undefined;
  /** Async hook invoked when WebSocket closes unexpectedly */
  onDisconnect?: ((code: number, reason: string) => void | Promise<void>) | undefined;
}

/**
 * Options for CDPConnection.create() factory method.
 *
 * Extends ConnectionOptions to include logger configuration for consistent
 * options object pattern across constructor and factory.
 */
export interface CreateOptions extends ConnectionOptions {
  /** Logger instance for connection lifecycle events */
  logger?: Logger;
}

/**
 * Information about a launched Chrome instance.
 */
export interface LaunchedChrome {
  /** Process ID of the Chrome instance */
  pid: number;
  /** Remote debugging port Chrome is listening on */
  port: number;
  /** Resolved Chrome user data directory (profile path) */
  userDataDir?: string | undefined;
  /** Async function to terminate Chrome and cleanup temp directories */
  kill: () => Promise<void>;
}

/**
 * Logger interface for connection module.
 *
 * Allows dependency injection of different logging implementations
 * without coupling to specific UI or logging libraries.
 *
 * Compatible with both console and bdg's Logger interface.
 */
export interface Logger {
  /** Log informational message */
  info(message: string): void;
  /** Log debug message (only shown with debug flag) */
  debug(message: string): void;
}

/**
 * Cleanup function type for resource management.
 */
export type CleanupFunction = () => void;
