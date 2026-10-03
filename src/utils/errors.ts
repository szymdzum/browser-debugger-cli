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

/**
 * Read the semantic exit code carried by an error, if any.
 *
 * Error classes across bdg (CommandError, IPCError, DaemonError, ...) expose a
 * numeric `exitCode`. Only integers in 1..255 are trusted, so a foreign error
 * carrying `exitCode: 0` (or garbage) can never turn a failure into success.
 * Anything else gets the fallback.
 *
 * @param error - Caught error
 * @param fallback - Exit code when the error carries none
 * @returns Exit code
 */
export function getErrorExitCode(error: unknown, fallback: number): number {
  if (error instanceof Error && 'exitCode' in error) {
    const code = error.exitCode;
    if (typeof code === 'number' && Number.isInteger(code) && code >= 1 && code <= 255) {
      return code;
    }
  }
  return fallback;
}
