/**
 * Semantic exit codes for agent-friendly error handling.
 *
 * Based on Square Engineering's semantic exit code system:
 * - 0: Success
 * - 1: Generic failure (backward compatibility)
 * - 80-99: User errors (invalid input, permissions, resource issues)
 * - 100-119: Software errors (bugs, integration failures, timeouts)
 *
 * Reference: https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/
 */

/**
 * Exit code constants following semantic ranges.
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
  CHROME_LAUNCH_FAILURE: 100,
  CDP_CONNECTION_FAILURE: 101,
  CDP_TIMEOUT: 102,
  SESSION_FILE_ERROR: 103,
  UNHANDLED_EXCEPTION: 104,
  SIGNAL_HANDLER_ERROR: 105,
} as const;
