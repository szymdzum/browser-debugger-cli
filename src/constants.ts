/**
 * Centralized configuration constants for BDG CLI
 *
 * This file contains all timing, limit, and configuration values used throughout the application.
 * Centralizing these values makes it easier to tune performance characteristics and maintain the codebase.
 */

// ============================================================================
// CHROME & CDP CONFIGURATION
// ============================================================================

/**
 * Default Chrome debugging port
 * @constant {number}
 */
export const DEFAULT_CHROME_DEBUG_PORT = 9222;

/**
 * Default Chrome debugging port (string version for CLI)
 * @constant {string}
 */
export const DEFAULT_DEBUG_PORT = '9222';

/**
 * Default Chrome user data directory name (relative to system temp)
 * @constant {string}
 */
export const DEFAULT_USER_DATA_DIR = '.bdg/chrome-profile';

// ============================================================================
// DATA COLLECTION LIMITS
// ============================================================================

/**
 * Maximum network requests to collect before dropping new requests
 * Prevents memory issues in long-running sessions with high network activity
 * @constant {number}
 */
export const MAX_NETWORK_REQUESTS = 10000;

/**
 * Maximum console messages to collect before dropping new messages
 * Prevents memory issues in long-running sessions with verbose console output
 * @constant {number}
 */
export const MAX_CONSOLE_MESSAGES = 10000;

/**
 * Maximum response body size to capture (5MB)
 * Response bodies larger than this will be skipped with a placeholder message
 * @constant {number}
 */
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Maximum items in lightweight preview (last N items)
 * Used for fast preview operations without loading full data
 * @constant {number}
 */
export const MAX_PREVIEW_ITEMS = 1000;

// ============================================================================
// CHROME CDP BUFFER LIMITS
// ============================================================================

/**
 * Total Chrome network buffer size (50MB)
 * Limits total memory used by Chrome for preserving network payloads
 * @constant {number}
 */
export const CHROME_NETWORK_BUFFER_TOTAL = 50 * 1024 * 1024; // 50MB

/**
 * Per-resource Chrome network buffer size (10MB)
 * Limits memory used per individual resource
 * @constant {number}
 */
export const CHROME_NETWORK_BUFFER_PER_RESOURCE = 10 * 1024 * 1024; // 10MB

/**
 * Chrome POST data buffer limit (1MB)
 * Limits size of POST body data included in requestWillBeSent notification
 * @constant {number}
 */
export const CHROME_POST_DATA_LIMIT = 1 * 1024 * 1024; // 1MB

// ============================================================================
// TIMEOUTS & INTERVALS
// ============================================================================

/**
 * DOM capture timeout (5 seconds)
 * Maximum time to wait for DOM snapshot capture
 * @constant {number}
 */
export const DOM_CAPTURE_TIMEOUT = 5000;

/**
 * Stale network request timeout (60 seconds)
 * Network requests incomplete after this duration are cleaned up
 * @constant {number}
 */
export const STALE_REQUEST_TIMEOUT = 60000;

/**
 * Stale request cleanup interval (30 seconds)
 * How often to check for and remove stale network requests
 * @constant {number}
 */
export const STALE_REQUEST_CLEANUP_INTERVAL = 30000;

/**
 * CDP connection timeout (10 seconds)
 * Maximum time to wait for CDP WebSocket connection to establish
 * @constant {number}
 */
export const CDP_CONNECTION_TIMEOUT = 10000;

/**
 * CDP command timeout (30 seconds)
 * Maximum time to wait for CDP command response
 * @constant {number}
 */
export const CDP_COMMAND_TIMEOUT = 30000;

/**
 * Default keepalive ping interval (30 seconds)
 * How often to send WebSocket ping to keep connection alive
 * @constant {number}
 */
export const CDP_KEEPALIVE_INTERVAL = 30000;

/**
 * Pong response timeout (5 seconds)
 * Maximum time to wait for pong response after ping
 * @constant {number}
 */
export const CDP_PONG_TIMEOUT = 5000;

/**
 * Target readiness wait timeout (15 seconds)
 * Maximum time to wait for CDP target to become ready
 * @constant {number}
 */
export const TARGET_READY_TIMEOUT = 15000;

/**
 * Chrome CDP availability wait timeout (10 seconds)
 * Maximum time to wait for Chrome CDP endpoint to become available
 * @constant {number}
 */
export const CHROME_CDP_WAIT_TIMEOUT = 10000;

/**
 * Chrome version check timeout (2 seconds)
 * Timeout for HTTP request to Chrome version endpoint
 * @constant {number}
 */
export const CHROME_VERSION_CHECK_TIMEOUT = 2000;

/**
 * Preview data write interval (5 seconds)
 * How often to write preview files during active session
 * @constant {number}
 */
export const PREVIEW_WRITE_INTERVAL = 5000;

/**
 * WebSocket connection check interval (2 seconds)
 * How often to verify WebSocket connection health
 * @constant {number}
 */
export const CONNECTION_CHECK_INTERVAL = 2000;

/**
 * Shutdown keepalive interval (1 second)
 * Keepalive interval during graceful shutdown
 * @constant {number}
 */
export const SHUTDOWN_KEEPALIVE_INTERVAL = 1000;

// ============================================================================
// POLLING INTERVALS
// ============================================================================

/**
 * CDP availability polling interval (200ms)
 * How often to poll Chrome CDP endpoint for availability
 * @constant {number}
 */
export const CDP_POLL_INTERVAL = 200;

/**
 * Target readiness polling interval (200ms)
 * How often to poll CDP target for readiness
 * @constant {number}
 */
export const TARGET_READY_POLL_INTERVAL = 200;

/**
 * About:blank additional wait time (500ms)
 * Extra wait time when target is on about:blank before considering it ready
 * @constant {number}
 */
export const ABOUT_BLANK_WAIT = 500;

// ============================================================================
// RETRY & BACKOFF CONFIGURATION
// ============================================================================

/**
 * Maximum connection retry attempts
 * How many times to retry CDP connection before giving up
 * @constant {number}
 */
export const MAX_CONNECTION_RETRIES = 3;

/**
 * Maximum reconnection attempts
 * How many times to attempt reconnection when connection is lost
 * @constant {number}
 */
export const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Maximum missed pong responses before connection considered dead
 * Number of consecutive missed pongs before triggering reconnection
 * @constant {number}
 */
export const MAX_MISSED_PONGS = 3;

/**
 * Base delay for exponential backoff (1 second)
 * Starting delay for exponential backoff algorithm
 * @constant {number}
 */
export const BACKOFF_BASE_DELAY = 1000;

/**
 * Maximum backoff delay for connection retry (5 seconds)
 * Cap on exponential backoff delay for initial connection attempts
 * @constant {number}
 */
export const BACKOFF_MAX_DELAY_CONNECTION = 5000;

/**
 * Maximum backoff delay for reconnection (10 seconds)
 * Cap on exponential backoff delay for reconnection attempts
 * @constant {number}
 */
export const BACKOFF_MAX_DELAY_RECONNECTION = 10000;

// ============================================================================
// UI FORMATTING
// ============================================================================

/**
 * Default URL truncation length for compact output
 * @constant {number}
 */
export const DEFAULT_URL_TRUNCATE_LENGTH = 60;

/**
 * Default text truncation line limit for compact output
 * @constant {number}
 */
export const DEFAULT_TEXT_TRUNCATE_LINES = 3;

// ============================================================================
// CLI OPTION DESCRIPTIONS
// ============================================================================

/**
 * Description for port option in CLI commands
 * @constant {string}
 */
export const PORT_OPTION_DESCRIPTION = 'Chrome debugging port';

/**
 * Description for timeout option in CLI commands
 * @constant {string}
 */
export const TIMEOUT_OPTION_DESCRIPTION = 'Auto-stop after timeout (optional)';

/**
 * Description for reuse-tab option in CLI commands
 * @constant {string}
 */
export const REUSE_TAB_OPTION_DESCRIPTION = 'Navigate existing tab instead of creating new one';

/**
 * Description for user-data-dir option in CLI commands
 * @constant {string}
 */
export const USER_DATA_DIR_OPTION_DESCRIPTION = 'Chrome user data directory (default: ~/.bdg/chrome-profile)';
