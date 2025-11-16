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
export const CHROME_PROFILE_DIR = 'chrome-profile';

/**
 * HTTP localhost address for CDP endpoints
 * Standard loopback address for Chrome DevTools Protocol
 */
export const HTTP_LOCALHOST = '127.0.0.1';

/**
 * Chrome headless mode flag
 * Uses new headless implementation for better compatibility
 */
export const HEADLESS_FLAG = '--headless=new';

/**
 * BDG-specific Chrome flags for automation and popup suppression
 * These flags are automatically applied when launching Chrome via chrome-launcher
 *
 * Note: Chrome has a known issue (Chromium bug #854609) where it steals focus on macOS
 * despite --disable-background-mode. This is a long-standing Chrome bug with no workaround.
 * Headless mode (--headless) avoids this issue entirely.
 */
export const BDG_CHROME_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-search-engine-choice-screen',
  '--disable-session-crashed-bubble', // Suppress "Restore Pages?" popup after unclean shutdown
  '--disable-infobars', // Disable all info bars including restore prompt
  '--disable-notifications', // Suppress notification permission prompts
  '--disable-features=Translate', // Suppress Google Translate popup (replaces deprecated --disable-translate)
  '--disable-background-mode', // Attempt to prevent focus stealing (doesn't work reliably on macOS)
];

/**
 * Docker-specific Chrome flags to work around GPU/graphics limitations
 * These flags disable hardware acceleration and GPU features that fail in containerized environments
 */
export const DOCKER_CHROME_FLAGS = [
  '--disable-gpu', // Disable GPU hardware acceleration
  '--disable-dev-shm-usage', // Overcome limited resource problems in Docker
  '--disable-software-rasterizer', // Don't fall back to software rendering
  '--single-process', // Run Chrome in single-process mode (safer in containers)
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
  'translate.enabled': false, // Disable Google Translate popup
  translate_site_blacklist: ['*'], // Block translate for all sites
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
 * Default page readiness timeout (2 seconds)
 * Maximum time to wait for page to be ready before proceeding
 * Uses adaptive detection for load, network stability, and DOM stability
 */
export const DEFAULT_PAGE_READINESS_TIMEOUT_MS = 2000;

// ============================================================================
// IPC CONFIGURATION
// ============================================================================

/**
 * IPC request timeout in milliseconds (45 seconds in production, 5 seconds in tests)
 * Maximum time to wait for IPC responses from daemon
 * Must accommodate: Chrome launch (~2s) + Page readiness detection (up to 30s) + buffer (~13s)
 *
 * Can be overridden via BDG_IPC_TIMEOUT_MS environment variable (used by tests)
 *
 * @returns IPC request timeout in milliseconds
 * @see docs/IMPROVEMENTS_ANALYSIS.md - Issue #3: Smart Page Readiness Detection
 */
export function getIPCRequestTimeout(): number {
  return process.env['BDG_IPC_TIMEOUT_MS'] !== undefined
    ? parseInt(process.env['BDG_IPC_TIMEOUT_MS'], 10)
    : 45000;
}

// ============================================================================
// CLI OPTION DESCRIPTIONS
// ============================================================================

/**
 * Description for port option in CLI commands
 */
export const PORT_OPTION_DESCRIPTION = 'Chrome debugging port';
