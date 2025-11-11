/**
 * Error utility functions.
 *
 * Helper functions for extracting error messages from unknown error types.
 */

/**
 * Extract error message from unknown error type.
 *
 * Safely extracts error messages from various error types:
 * - Error instances → error.message
 * - Unknown types → String(error)
 *
 * Useful for error handling when error type is unknown.
 *
 * @param error - Error of unknown type
 * @returns Error message string
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   throw new ChromeLaunchError(`Failed: ${getErrorMessage(error)}`, error);
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Detect whether an error indicates the daemon/socket is unavailable.
 */
export function isDaemonConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('ENOENT') || message.includes('ECONNREFUSED');
}
