/**
 * Semantic exit codes for agent-friendly error handling.
 *
 * **STABILITY: These exit codes are part of bdg's stable public API.**
 *
 * Exit codes follow semantic ranges for predictable automation:
 * - **0**: Success (command completed successfully)
 * - **1**: Generic failure (backward compatibility, avoid in new code)
 * - **80-99**: User errors (invalid input, permissions, resource issues)
 * - **100-119**: Software errors (bugs, integration failures, timeouts)
 *
 * **Versioning guarantees:**
 * - Exit code values are **stable** and will not change in minor versions
 * - New exit codes may be added in minor versions (within existing ranges)
 * - Existing codes will only be removed in major versions with deprecation notice
 * - Exit code semantics (meaning) will remain consistent across versions
 *
 * **For automation users:**
 * - Check specific exit codes (e.g., 83 for "resource not found")
 * - Use ranges for category detection (80-99 = user error, 100-119 = software error)
 * - Exit code 0 guarantees success, non-zero indicates failure
 *
 * **Migration policy:**
 * - Deprecated codes will be documented in CHANGELOG.md with migration path
 * - Deprecated codes will remain functional for at least one major version
 *
 * Reference: https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/
 *
 * @since 0.1.0 - Initial exit code system
 */

/**
 * Exit code constants following semantic ranges.
 *
 * **These values are stable API** - use confidently in automation scripts.
 */
export const EXIT_CODES = {
  /** Command completed successfully */
  SUCCESS: 0,

  /** Generic failure (use specific codes when possible) */
  GENERIC_FAILURE: 1,

  // User Errors (80-99): Issues caused by user input or environment

  /** Invalid URL format or unreachable URL */
  INVALID_URL: 80,

  /** Invalid command-line arguments or options */
  INVALID_ARGUMENTS: 81,

  /** Insufficient permissions for operation */
  PERMISSION_DENIED: 82,

  /** Requested resource not found (session, file, etc.) */
  RESOURCE_NOT_FOUND: 83,

  /** Resource already exists (duplicate session, etc.) */
  RESOURCE_ALREADY_EXISTS: 84,

  /** Resource is locked or busy */
  RESOURCE_BUSY: 85,

  /** Daemon already running when trying to start */
  DAEMON_ALREADY_RUNNING: 86,

  // Software Errors (100-119): Internal failures or integration issues

  /** Chrome browser failed to launch */
  CHROME_LAUNCH_FAILURE: 100,

  /** CDP connection failed */
  CDP_CONNECTION_FAILURE: 101,

  /** CDP operation timed out */
  CDP_TIMEOUT: 102,

  /** Session file read/write error */
  SESSION_FILE_ERROR: 103,

  /** Unhandled exception in code */
  UNHANDLED_EXCEPTION: 104,

  /** Signal handler error */
  SIGNAL_HANDLER_ERROR: 105,

  /** Generic software error (use specific codes when possible) */
  SOFTWARE_ERROR: 110,
} as const;
