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
 */
export const DEFAULT_CDP_PORT = 9222;

/**
 * Default Chrome debugging port (string version for CLI argument parsing)
 * Derived from DEFAULT_CDP_PORT to maintain single source of truth
 */
export const DEFAULT_DEBUG_PORT = String(DEFAULT_CDP_PORT);

/**
 * Default Chrome launcher log level for quiet operation
 */
export const DEFAULT_CHROME_LOG_LEVEL = 'silent';

/**
 * Default SIGINT handling - bdg handles signals, not chrome-launcher
 */
export const DEFAULT_CHROME_HANDLE_SIGINT = false;

/**
 * Persistent Chrome profile directory path (relative to user home)
 */
export const CHROME_PROFILE_DIR = '.bdg/chrome-profile';

/**
 * Maximum CDP connection retry attempts before failing
 */
export const CDP_MAX_CONNECTION_RETRIES = 3;

/**
 * CDP connection timeout in milliseconds (10 seconds)
 * Maximum time to wait for WebSocket connection to establish
 */
export const CDP_CONNECTION_TIMEOUT_MS = 10000;

/**
 * CDP command timeout in milliseconds (30 seconds)
 * Maximum time to wait for CDP command responses
 * Balances responsiveness with time for heavy operations (DOM traversal, etc.)
 */
export const CDP_COMMAND_TIMEOUT_MS = 30000;

/**
 * CDP keepalive ping interval in milliseconds (30 seconds)
 * Prevents connection timeout during long-running sessions
 */
export const CDP_KEEPALIVE_INTERVAL = 30000;

/**
 * Enable CDP target discovery for tab detection
 */
export const CDP_DISCOVER_TARGETS = true;

/**
 * CDP reconnection retry limit
 * Maximum number of reconnection attempts before giving up
 */
export const CDP_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * CDP base retry delay in milliseconds (1 second)
 * Starting delay for exponential backoff retry strategy
 */
export const CDP_BASE_RETRY_DELAY_MS = 1000;

/**
 * CDP maximum retry delay in milliseconds (5 seconds)
 * Cap for exponential backoff during connection retries
 */
export const CDP_MAX_RETRY_DELAY_MS = 5000;

/**
 * CDP maximum reconnection delay in milliseconds (10 seconds)
 * Cap for exponential backoff during reconnection attempts
 */
export const CDP_MAX_RECONNECT_DELAY_MS = 10000;

/**
 * CDP keepalive maximum missed pongs threshold
 * Connection is considered dead after this many consecutive missed pongs
 */
export const CDP_MAX_MISSED_PONGS = 3;

/**
 * CDP pong timeout in milliseconds (5 seconds)
 * Maximum time to wait for pong response after sending ping
 */
export const CDP_PONG_TIMEOUT_MS = 5000;

/**
 * WebSocket normal closure code (RFC 6455)
 * Indicates graceful connection shutdown
 */
export const WEBSOCKET_NORMAL_CLOSURE = 1000;

/**
 * WebSocket no pong received closure code
 * Custom code for keepalive failure (no pong received)
 */
export const WEBSOCKET_NO_PONG_CLOSURE = 1001;

/**
 * UTF-8 text encoding identifier
 * Standard encoding for text data conversion
 */
export const UTF8_ENCODING = 'utf8';

/**
 * CDP target type for browser pages
 * Identifies page-type targets (vs service workers, extensions, etc.)
 */
export const PAGE_TARGET_TYPE = 'page';

/**
 * Blank page URL used by Chrome
 * Standard initial/empty page URL
 */
export const BLANK_PAGE_URL = 'about:blank';

/**
 * CDP createTarget new window flag (default: false for tabs)
 * Controls whether targets are created as new windows or tabs
 */
export const CDP_NEW_WINDOW_FLAG = false;

/**
 * CDP attachToTarget flatten flag (default: true for simplified sessions)
 * Prevents nested session hierarchies for easier management
 */
export const CDP_FLATTEN_SESSION_FLAG = true;

/**
 * HTTP localhost address for CDP endpoints
 * Standard loopback address for Chrome DevTools Protocol
 */
export const HTTP_LOCALHOST = '127.0.0.1';

/**
 * Default target readiness timeout in milliseconds (15 seconds)
 * Maximum time to wait for tab navigation to complete
 */
export const DEFAULT_TARGET_READY_TIMEOUT_MS = 15000;

/**
 * Target readiness poll interval in milliseconds (200ms)
 * Frequency of status checks during tab navigation
 */
export const TARGET_READY_POLL_INTERVAL_MS = 200;

/**
 * Additional wait time for loading pages in milliseconds (500ms)
 * Extra delay when page shows about:blank during navigation
 */
export const LOADING_PAGE_ADDITIONAL_WAIT_MS = 500;

/**
 * Default verification timeout in milliseconds (5 seconds)
 * Time to wait for target to appear in Chrome's target list after creation
 */
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 5000;

/**
 * Initial verification delay in milliseconds (200ms)
 * Starting delay for exponential backoff during target verification
 */
export const VERIFICATION_INITIAL_DELAY_MS = 200;

/**
 * Maximum verification delay in milliseconds (1 second)
 * Cap for exponential backoff during target verification
 */
export const VERIFICATION_MAX_DELAY_MS = 1000;

/**
 * Verification backoff multiplier
 * Factor for exponential backoff delay calculation
 */
export const VERIFICATION_BACKOFF_MULTIPLIER = 2;

/**
 * Chrome headless mode flag
 * Uses new headless implementation for better compatibility
 */
export const HEADLESS_FLAG = '--headless=new';

/**
 * BDG-specific Chrome flags for automation and popup suppression
 * These flags are automatically applied when launching Chrome via chrome-launcher
 */
export const BDG_CHROME_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-search-engine-choice-screen',
  '--disable-session-crashed-bubble', // Suppress "Restore Pages?" popup after unclean shutdown
  '--disable-infobars', // Disable all info bars including restore prompt
];

/**
 * BDG-specific Chrome preferences for automation
 * These preferences are automatically merged with user preferences when launching Chrome
 * User preferences take precedence over these defaults
 *
 * Note: Crash/restore popup suppression is handled by Chrome flags (--disable-session-crashed-bubble, --disable-infobars)
 * which are more reliable than preference-based approaches.
 */
export const BDG_CHROME_PREFS: Record<string, unknown> = {
  'browser.show_quit_confirmation_dialog': false, // Disable quit confirmation for automation
};

// ============================================================================
// DATA COLLECTION LIMITS
// ============================================================================

/**
 * Maximum network requests to collect before dropping new requests
 * Prevents memory issues in long-running sessions with high network activity
 */
export const MAX_NETWORK_REQUESTS = 10000;

/**
 * Maximum console messages to collect before dropping new messages
 * Prevents memory issues in long-running sessions with verbose console output
 */
export const MAX_CONSOLE_MESSAGES = 10000;

/**
 * Maximum response body size to capture (5MB)
 * Response bodies larger than this will be skipped with a placeholder message
 * Can be overridden with --max-body-size flag
 */
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

// ============================================================================
// CHROME CDP BUFFER LIMITS
// ============================================================================

/**
 * Total Chrome network buffer size (50MB)
 * Limits total memory used by Chrome for preserving network payloads
 */
export const CHROME_NETWORK_BUFFER_TOTAL = 50 * 1024 * 1024; // 50MB

/**
 * Per-resource Chrome network buffer size (10MB)
 * Limits memory used per individual resource
 */
export const CHROME_NETWORK_BUFFER_PER_RESOURCE = 10 * 1024 * 1024; // 10MB

/**
 * Chrome POST data buffer limit (1MB)
 * Limits size of POST body data included in requestWillBeSent notification
 */
export const CHROME_POST_DATA_LIMIT = 1 * 1024 * 1024; // 1MB

// ============================================================================
// TIMEOUTS & INTERVALS
// ============================================================================

/**
 * Stale network request timeout (60 seconds)
 * Network requests incomplete after this duration are cleaned up
 */
export const STALE_REQUEST_TIMEOUT = 60000;

/**
 * Stale request cleanup interval (30 seconds)
 * How often to check for and remove stale network requests
 */
export const STALE_REQUEST_CLEANUP_INTERVAL = 30000;

/**
 * Memory usage logging interval (30 seconds)
 * How often to log memory statistics during session collection
 */
export const MEMORY_LOG_INTERVAL = 30000;

// ============================================================================
// CLI OPTION DESCRIPTIONS
// ============================================================================

/**
 * Description for port option in CLI commands
 */
export const PORT_OPTION_DESCRIPTION = 'Chrome debugging port';

/**
 * Description for timeout option in CLI commands
 */
export const TIMEOUT_OPTION_DESCRIPTION = 'Auto-stop after timeout (optional)';

/**
 * Description for reuse-tab option in CLI commands
 */
export const REUSE_TAB_OPTION_DESCRIPTION = 'Navigate existing tab instead of creating new one';

/**
 * Default value for reuse-tab option
 * When true, bdg will attempt to find and reuse existing tabs instead of creating new ones
 * This is the preferred default for better UX and avoiding tab proliferation
 */
export const DEFAULT_REUSE_TAB = true;

/**
 * Description for user-data-dir option in CLI commands
 */
export const USER_DATA_DIR_OPTION_DESCRIPTION =
  'Chrome user data directory (default: ~/.bdg/chrome-profile)';

/**
 * Description for log-level option in CLI commands
 */
export const LOG_LEVEL_OPTION_DESCRIPTION =
  'Chrome launcher log level (verbose|info|error|silent, default: silent)';

/**
 * Description for chrome-prefs option in CLI commands
 */
export const CHROME_PREFS_OPTION_DESCRIPTION = 'Chrome preferences as inline JSON string';

/**
 * Description for chrome-prefs-file option in CLI commands
 */
export const CHROME_PREFS_FILE_OPTION_DESCRIPTION =
  'Path to JSON file containing Chrome preferences';

/**
 * Description for chrome-flags option in CLI commands
 */
export const CHROME_FLAGS_OPTION_DESCRIPTION = 'Additional Chrome command-line flags (repeatable)';

/**
 * Description for connection-poll-interval option in CLI commands
 */
export const CONNECTION_POLL_INTERVAL_OPTION_DESCRIPTION =
  'Milliseconds between CDP readiness checks (default: 500)';

/**
 * Description for max-connection-retries option in CLI commands
 */
export const MAX_CONNECTION_RETRIES_OPTION_DESCRIPTION =
  'Maximum retry attempts before failing (default: 50)';

/**
 * Description for port-strict option in CLI commands
 */
export const PORT_STRICT_OPTION_DESCRIPTION = 'Fail if Chrome debugging port is already in use';
