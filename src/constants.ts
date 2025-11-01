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
 * Default Chrome debugging port (string version for CLI)
 * @constant {string}
 */
export const DEFAULT_DEBUG_PORT = '9222';

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
export const USER_DATA_DIR_OPTION_DESCRIPTION =
  'Chrome user data directory (default: ~/.bdg/chrome-profile)';
