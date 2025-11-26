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
 */

/**
 * Exit code constants following semantic ranges.
 *
 * **These values are stable API** - use confidently in automation scripts.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_FAILURE: 1,
  INVALID_URL: 80,
  INVALID_ARGUMENTS: 81,
  PERMISSION_DENIED: 82,
  RESOURCE_NOT_FOUND: 83,
  RESOURCE_ALREADY_EXISTS: 84,
  RESOURCE_BUSY: 85,
  DAEMON_ALREADY_RUNNING: 86,
  STALE_CACHE: 87,
  CHROME_LAUNCH_FAILURE: 100,
  CDP_CONNECTION_FAILURE: 101,
  CDP_TIMEOUT: 102,
  SESSION_FILE_ERROR: 103,
  UNHANDLED_EXCEPTION: 104,
  SIGNAL_HANDLER_ERROR: 105,
  SOFTWARE_ERROR: 110,
} as const;

/**
 * Exit code registry entry with code, name, and description.
 */
interface ExitCodeEntry {
  readonly code: number;
  readonly name: string;
  readonly description: string;
}

/**
 * Exit code registry - provides documentation for all exit codes.
 *
 * This registry is derived from EXIT_CODES to ensure consistency.
 * Used by help --json for machine-readable documentation.
 */
export const EXIT_CODE_REGISTRY: readonly ExitCodeEntry[] = [
  { code: EXIT_CODES.SUCCESS, name: 'SUCCESS', description: 'Operation completed successfully' },
  {
    code: EXIT_CODES.GENERIC_FAILURE,
    name: 'GENERIC_FAILURE',
    description: 'Generic failure (use specific codes when possible)',
  },
  {
    code: EXIT_CODES.INVALID_URL,
    name: 'INVALID_URL',
    description: 'Invalid URL format or unreachable URL',
  },
  {
    code: EXIT_CODES.INVALID_ARGUMENTS,
    name: 'INVALID_ARGUMENTS',
    description: 'Invalid command-line arguments or options',
  },
  {
    code: EXIT_CODES.PERMISSION_DENIED,
    name: 'PERMISSION_DENIED',
    description: 'Insufficient permissions for operation',
  },
  {
    code: EXIT_CODES.RESOURCE_NOT_FOUND,
    name: 'RESOURCE_NOT_FOUND',
    description: 'Requested resource not found (session, file, etc.)',
  },
  {
    code: EXIT_CODES.RESOURCE_ALREADY_EXISTS,
    name: 'RESOURCE_ALREADY_EXISTS',
    description: 'Resource already exists (duplicate session, etc.)',
  },
  {
    code: EXIT_CODES.RESOURCE_BUSY,
    name: 'RESOURCE_BUSY',
    description: 'Resource is locked or busy',
  },
  {
    code: EXIT_CODES.DAEMON_ALREADY_RUNNING,
    name: 'DAEMON_ALREADY_RUNNING',
    description: 'Daemon is already running',
  },
  {
    code: EXIT_CODES.STALE_CACHE,
    name: 'STALE_CACHE',
    description: 'Cache invalidated by navigation or DOM changes',
  },
  {
    code: EXIT_CODES.CHROME_LAUNCH_FAILURE,
    name: 'CHROME_LAUNCH_FAILURE',
    description: 'Chrome browser failed to launch',
  },
  {
    code: EXIT_CODES.CDP_CONNECTION_FAILURE,
    name: 'CDP_CONNECTION_FAILURE',
    description: 'Failed to connect to Chrome DevTools Protocol',
  },
  { code: EXIT_CODES.CDP_TIMEOUT, name: 'CDP_TIMEOUT', description: 'CDP operation timed out' },
  {
    code: EXIT_CODES.SESSION_FILE_ERROR,
    name: 'SESSION_FILE_ERROR',
    description: 'Session file read/write error',
  },
  {
    code: EXIT_CODES.UNHANDLED_EXCEPTION,
    name: 'UNHANDLED_EXCEPTION',
    description: 'Unhandled exception in code',
  },
  {
    code: EXIT_CODES.SIGNAL_HANDLER_ERROR,
    name: 'SIGNAL_HANDLER_ERROR',
    description: 'Signal handler error',
  },
  {
    code: EXIT_CODES.SOFTWARE_ERROR,
    name: 'SOFTWARE_ERROR',
    description: 'Generic software error (use specific codes when possible)',
  },
];
