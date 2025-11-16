/**
 * Error handling utilities.
 *
 * Pure utility functions for error message extraction.
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
 *   console.error(`Failed: ${getErrorMessage(error)}`);
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
