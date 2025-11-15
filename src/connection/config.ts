/**
 * CDP connection configuration.
 *
 * Provides type-safe configuration objects to replace direct constant imports.
 * Allows runtime configuration and easier testing.
 */

/**
 * Configuration for CDP WebSocket connections.
 *
 * Controls timeouts, retry behavior, and keepalive settings for
 * Chrome DevTools Protocol connections.
 */
export interface CDPConfig {
  /** Command timeout in milliseconds (default: 30000) */
  commandTimeout: number;
  /** Connection timeout in milliseconds (default: 10000) */
  connectionTimeout: number;
  /** Keepalive ping interval in milliseconds (default: 30000) */
  keepaliveInterval: number;
  /** Maximum connection retry attempts (default: 3) */
  maxConnectionRetries: number;
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts: number;
  /** Base retry delay in milliseconds (default: 1000) */
  baseRetryDelay: number;
  /** Maximum retry delay in milliseconds (default: 5000) */
  maxRetryDelay: number;
  /** Maximum reconnect delay in milliseconds (default: 10000) */
  maxReconnectDelay: number;
  /** Maximum missed pongs before considering connection dead (default: 3) */
  maxMissedPongs: number;
  /** Pong timeout in milliseconds (default: 5000) */
  pongTimeout: number;
}

/**
 * Default CDP configuration values.
 *
 * These defaults are tuned for typical web application debugging:
 * - 30s command timeout allows heavy DOM operations
 * - 10s connection timeout balances responsiveness and reliability
 * - 30s keepalive prevents idle connection termination
 * - 3 retries handles transient network issues
 * - Exponential backoff prevents thundering herd
 */
export const DEFAULT_CDP_CONFIG: CDPConfig = {
  commandTimeout: 30000,
  connectionTimeout: 10000,
  keepaliveInterval: 30000,
  maxConnectionRetries: 3,
  maxReconnectAttempts: 5,
  baseRetryDelay: 1000,
  maxRetryDelay: 5000,
  maxReconnectDelay: 10000,
  maxMissedPongs: 3,
  pongTimeout: 5000,
};

/**
 * WebSocket configuration constants.
 */
export const WEBSOCKET_CONFIG = {
  /** WebSocket handshake timeout in milliseconds */
  handshakeTimeout: 5000,
  /** Maximum payload size in bytes (100MB for large DOM snapshots) */
  maxPayload: 100 * 1024 * 1024,
  /** Normal closure code */
  normalClosure: 1000,
  /** No pong received closure code */
  noPongClosure: 1001,
} as const;

/**
 * Text encoding constant for WebSocket messages.
 */
export const UTF8_ENCODING = 'utf8' as const;
