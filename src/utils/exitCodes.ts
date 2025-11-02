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

  // Software/Integration errors (100-119)
  CHROME_LAUNCH_FAILURE: 100,
  CDP_CONNECTION_FAILURE: 101,
  CDP_TIMEOUT: 102,
  SESSION_FILE_ERROR: 103,
  UNHANDLED_EXCEPTION: 104,
  SIGNAL_HANDLER_ERROR: 105,
} as const;

/**
 * Map of BdgError codes to semantic exit codes.
 */
const ERROR_CODE_MAP: Record<string, number> = {
  // User errors
  INVALID_URL_ERROR: EXIT_CODES.INVALID_URL,
  INVALID_ARGUMENTS: EXIT_CODES.INVALID_ARGUMENTS,
  PERMISSION_DENIED: EXIT_CODES.PERMISSION_DENIED,
  RESOURCE_NOT_FOUND: EXIT_CODES.RESOURCE_NOT_FOUND,
  RESOURCE_ALREADY_EXISTS: EXIT_CODES.RESOURCE_ALREADY_EXISTS,
  RESOURCE_BUSY: EXIT_CODES.RESOURCE_BUSY,

  // Software/Integration errors
  CHROME_LAUNCH_ERROR: EXIT_CODES.CHROME_LAUNCH_FAILURE,
  CDP_CONNECTION_ERROR: EXIT_CODES.CDP_CONNECTION_FAILURE,
  CDP_TIMEOUT_ERROR: EXIT_CODES.CDP_TIMEOUT,
  SESSION_FILE_ERROR: EXIT_CODES.SESSION_FILE_ERROR,
};

/**
 * Get semantic exit code for an error.
 *
 * Maps error types to appropriate exit code ranges:
 * - BdgError with known code → specific exit code
 * - BdgError with unknown code → category-based exit code
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
  // Handle BdgError instances
  if (error instanceof BdgError) {
    // Check for specific error code mapping
    const mappedCode = ERROR_CODE_MAP[error.code];
    if (mappedCode !== undefined) {
      return mappedCode;
    }

    // Fallback to category-based mapping
    switch (error.category) {
      case 'user':
        return EXIT_CODES.INVALID_ARGUMENTS;
      case 'system':
      case 'external':
        return EXIT_CODES.UNHANDLED_EXCEPTION;
    }
  }

  // Unknown error type
  return EXIT_CODES.UNHANDLED_EXCEPTION;
}

/**
 * Check if an exit code indicates a user error (80-99).
 * Useful for agents to determine if they should retry.
 */
export function isUserError(exitCode: number): boolean {
  return exitCode >= 80 && exitCode <= 99;
}

/**
 * Check if an exit code indicates a software error (100-119).
 * Some of these may be retryable (e.g., timeouts, connection failures).
 */
export function isSoftwareError(exitCode: number): boolean {
  return exitCode >= 100 && exitCode <= 119;
}

/**
 * Check if an exit code indicates a potentially retryable error.
 * Currently: connection failures and timeouts.
 */
export function isRetryable(exitCode: number): boolean {
  const retryableCodes: number[] = [
    EXIT_CODES.CDP_CONNECTION_FAILURE,
    EXIT_CODES.CDP_TIMEOUT,
    EXIT_CODES.CHROME_LAUNCH_FAILURE, // May be retryable if transient
  ];
  return retryableCodes.includes(exitCode);
}
