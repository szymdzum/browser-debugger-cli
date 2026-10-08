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
 * Default Chrome launcher log level for quiet operation
 */
export const DEFAULT_CHROME_LOG_LEVEL = 'silent';

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
  '--hide-crash-restore-bubble', // New flag to hide crash restore bubble
  '--disable-infobars', // Disable all info bars including restore prompt
  '--disable-notifications', // Suppress notification permission prompts
  '--disable-features=Translate,SessionCrashedBubble', // Suppress Google Translate popup and SessionCrashedBubble
  '--disable-background-mode', // Attempt to prevent focus stealing (doesn't work reliably on macOS)
  '--window-size=1920,1080', // Default viewport for consistent screenshots
];

/**
 * Docker-specific Chrome flags to work around GPU/graphics limitations
 * These flags disable hardware acceleration and GPU features that fail in containerized environments
 */
export const DOCKER_CHROME_FLAGS = [
  '--disable-gpu', // Disable GPU hardware acceleration
  '--disable-dev-shm-usage', // Overcome limited resource problems in Docker
  '--disable-software-rasterizer', // Don't fall back to software rendering
];

/**
 * BDG-specific Chrome preferences for automation
 * Written into the launched profile's Default/Preferences (dotted names become nested paths)
 * before every launch, so persistent profiles get them too. User preferences take precedence.
 *
 * The password manager and its leak check are off: after a login their bubble
 * (e.g. "Change your password") captures all input in headless Chrome, so
 * later clicks silently never reach the page.
 *
 * Note: Crash/restore popup suppression is handled by Chrome flags (--disable-session-crashed-bubble, --disable-infobars)
 * which are more reliable than preference-based approaches.
 */
export const BDG_CHROME_PREFS: Record<string, unknown> = {
  'browser.show_quit_confirmation_dialog': false, // Disable quit confirmation for automation
  'translate.enabled': false, // Disable Google Translate popup
  translate_site_blacklist: ['*'], // Block translate for all sites
  'profile.exit_type': 'Normal', // Trick Chrome into thinking it shut down correctly
  credentials_enable_service: false, // No "Save password?" bubble
  'profile.password_manager_enabled': false, // Password manager off
  'profile.password_manager_leak_detection': false, // No "Change your password" breach dialog
};

// ============================================================================
// DATA COLLECTION LIMITS
// ============================================================================

/**
 * Finished network requests kept: past this the oldest are dropped, so the
 * newest are kept (requests in flight are never dropped)
 * Prevents memory issues in long-running sessions with high network activity
 */
export const MAX_NETWORK_REQUESTS = 10000;

/**
 * Maximum console messages to collect before dropping new messages
 * Prevents memory issues in long-running sessions with verbose console output
 */
export const MAX_CONSOLE_MESSAGES = 10000;

// ============================================================================
// OBJECT EXPANSION CONFIGURATION
// ============================================================================

/**
 * Maximum depth for nested object expansion via Runtime.getProperties
 * Prevents infinite recursion and excessive CDP calls for deeply nested objects
 */
export const OBJECT_EXPANSION_MAX_DEPTH = 3;

/**
 * Maximum properties to expand per object
 * Limits output size and CDP calls for objects with many properties
 */
export const OBJECT_EXPANSION_MAX_PROPERTIES = 10;

/**
 * Maximum consecutive expansion failures before logging warning
 * Helps detect CDP connection issues without spamming logs
 */
export const OBJECT_EXPANSION_FAILURE_THRESHOLD = 5;

/**
 * Maximum response body size to capture (5MB)
 * Response bodies larger than this will be skipped with a placeholder message
 * Can be overridden with --max-body-size flag
 */
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Total size of the request and response bodies a session keeps (100MB)
 * Past this the oldest bodies are replaced by a placeholder; their requests stay
 */
export const MAX_TOTAL_BODY_BYTES = 100 * 1024 * 1024;

// ============================================================================
// OUTPUT VALUE LIMITS (lifted by --full)
// ============================================================================

/**
 * Characters of one value `dom get --raw` and `dom eval` print (human output,
 * and eval string results and outer HTML in JSON)
 */
export const MAX_VALUE_LENGTH = 20_000;

/**
 * Characters of a console message text in human output (`console`, `peek`)
 */
export const MAX_CONSOLE_TEXT_LENGTH = 200;

/**
 * Characters of a console message text in JSON output (`console`, `peek`)
 */
export const MAX_CONSOLE_JSON_TEXT_LENGTH = 10_000;

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
// JSON LIST LIMITS
// ============================================================================

/** Matches `dom query` and `dom a11y query` list with `--json` and no `--limit` */
export const QUERY_JSON_LIST_LIMIT = 100;

/** Elements of an array result `dom eval --json` lists (the rest are counted as omitted) */
export const EVAL_JSON_ARRAY_LIMIT = 100;

/** Matches `dom layout` measures per command (the rest are counted as omitted) */
export const LAYOUT_ELEMENT_LIMIT = 100;

/**
 * Requests listed in an action's result (a click that loads a page triggers
 * its whole load); notable ones are kept before assets
 */
export const MAX_TRIGGERED_REQUESTS = 50;

// ============================================================================
// TIMEOUTS & INTERVALS
// ============================================================================

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
 * Maximum size of one JSONL message from the daemon (256 MB, below V8's
 * maximum string length so joining a message cannot fail).
 * Guards against a process sending data without newlines; large enough for
 * HAR exports of long sessions with response bodies (`--all`).
 */
export const MAX_JSONL_BUFFER_SIZE = 256 * 1024 * 1024;

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

/**
 * Timeout for small requests the daemon answers from memory (status, peek,
 * details, headers): a daemon that does not answer these within seconds is
 * not responding, so commands do not wait the full IPC timeout. HAR data is
 * excluded: a large session's requests and bodies take longer to transfer.
 *
 * @returns Timeout in milliseconds (10 s, or the IPC timeout if shorter)
 */
export function getQuickIPCRequestTimeout(): number {
  return Math.min(10000, getIPCRequestTimeout());
}

// ============================================================================
// CLI OPTION DESCRIPTIONS
// ============================================================================

/**
 * Description for port option in CLI commands
 */
export const PORT_OPTION_DESCRIPTION = 'Chrome debugging port';

/**
 * CDP resource type to compact abbreviation mapping.
 * Used for token-efficient display in preview/peek output.
 */
export const RESOURCE_TYPE_ABBREVIATIONS: Record<string, string> = {
  Document: 'DOC',
  Stylesheet: 'CSS',
  Image: 'IMG',
  Media: 'MED',
  Font: 'FNT',
  Script: 'SCR',
  TextTrack: 'TXT',
  XHR: 'XHR',
  Fetch: 'FET',
  Prefetch: 'PRE',
  EventSource: 'EVT',
  WebSocket: 'WS',
  Manifest: 'MAN',
  SignedExchange: 'SGX',
  Ping: 'PIN',
  CSPViolationReport: 'CSP',
  Preflight: 'FLT',
  FedCM: 'FED',
  Other: 'OTH',
};

/**
 * The CDP resource type a user means: its name or its abbreviation from
 * `network list` (`WS`, `DOC`, `FET`), in any case.
 *
 * @param name - Type as typed
 * @returns CDP resource type, or undefined if unknown
 */
export function resourceTypeFromName(name: string): string | undefined {
  const wanted = name.trim().toLowerCase();
  return Object.entries(RESOURCE_TYPE_ABBREVIATIONS).find(
    ([type, abbreviation]) => type.toLowerCase() === wanted || abbreviation.toLowerCase() === wanted
  )?.[0];
}

/**
 * Rules for inferring resource types from MIME patterns.
 * Ordered by precedence (first match wins).
 * Type uses string to avoid circular dependency with typed-cdp.
 */
export const MIME_TYPE_RULES: Array<{
  type: string;
  match: RegExp;
}> = [
  { type: 'Document', match: /text\/html/i },
  { type: 'Stylesheet', match: /text\/css/i },
  { type: 'Script', match: /(java|ecma)script/i },
  { type: 'Image', match: /^image\//i },
  { type: 'Font', match: /font/i },
  { type: 'Media', match: /^(video|audio)\//i },
  { type: 'XHR', match: /json|xml/i },
];
