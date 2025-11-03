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
 * Can be overridden with --max-body-size flag
 * @constant {number}
 */
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Default maximum response body size for user override (10MB)
 * @constant {number}
 */
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

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

/**
 * Description for log-level option in CLI commands
 * @constant {string}
 */
export const LOG_LEVEL_OPTION_DESCRIPTION =
  'Chrome launcher log level (verbose|info|error|silent, default: silent)';

/**
 * Description for chrome-prefs option in CLI commands
 * @constant {string}
 */
export const CHROME_PREFS_OPTION_DESCRIPTION = 'Chrome preferences as inline JSON string';

/**
 * Description for chrome-prefs-file option in CLI commands
 * @constant {string}
 */
export const CHROME_PREFS_FILE_OPTION_DESCRIPTION =
  'Path to JSON file containing Chrome preferences';

/**
 * Description for chrome-flags option in CLI commands
 * @constant {string}
 */
export const CHROME_FLAGS_OPTION_DESCRIPTION = 'Additional Chrome command-line flags (repeatable)';

/**
 * Description for connection-poll-interval option in CLI commands
 * @constant {string}
 */
export const CONNECTION_POLL_INTERVAL_OPTION_DESCRIPTION =
  'Milliseconds between CDP readiness checks (default: 500)';

/**
 * Description for max-connection-retries option in CLI commands
 * @constant {string}
 */
export const MAX_CONNECTION_RETRIES_OPTION_DESCRIPTION =
  'Maximum retry attempts before failing (default: 50)';

/**
 * Description for port-strict option in CLI commands
 * @constant {string}
 */
export const PORT_STRICT_OPTION_DESCRIPTION = 'Fail if Chrome debugging port is already in use';
