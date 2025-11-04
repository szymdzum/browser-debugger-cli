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

import { BdgError } from './errors.js';

/**
 * Exit code constants following semantic ranges.
 */
export const EXIT_CODES = {
  // Success
  SUCCESS: 0,

  // Generic failure (backward compatibility)
  GENERIC_FAILURE: 1,

  // User errors (80-99)
  INVALID_URL: 80,
  INVALID_ARGUMENTS: 81,
  PERMISSION_DENIED: 82,
  RESOURCE_NOT_FOUND: 83,
  RESOURCE_ALREADY_EXISTS: 84,
  RESOURCE_BUSY: 85,
  DAEMON_ALREADY_RUNNING: 86,

  // Software/Integration errors (100-119)
  CHROME_LAUNCH_FAILURE: 100,
  CDP_CONNECTION_FAILURE: 101,
  CDP_TIMEOUT: 102,
  SESSION_FILE_ERROR: 103,
  UNHANDLED_EXCEPTION: 104,
  SIGNAL_HANDLER_ERROR: 105,
} as const;

/**
 * Get semantic exit code for an error.
 *
 * Maps error types to appropriate exit code ranges:
 * - BdgError → uses exitCode property from error class
 * - Unknown error → UNHANDLED_EXCEPTION
 *
 * @param error - Error instance
 * @returns Semantic exit code
 *
 * @example
 * ```typescript
 * try {
 *   await operation();
 * } catch (error) {
 *   const exitCode = getExitCodeForError(error);
 *   process.exit(exitCode);
 * }
 * ```
 */
export function getExitCodeForError(error: unknown): number {
  // Handle BdgError instances - exit code is embedded in the class
  if (error instanceof BdgError) {
    return error.exitCode;
  }

  // Unknown error type
  return EXIT_CODES.UNHANDLED_EXCEPTION;
}
