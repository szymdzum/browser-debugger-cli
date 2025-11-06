/**
 * Structured error handling for CLI commands.
 *
 * Provides CommandError class for throwing errors with metadata and exit codes.
 */

/**
 * Custom error class for CLI commands with structured metadata.
 *
 * Extends Error to include additional context like suggestions, notes,
 * and specific exit codes for better user experience and automation support.
 *
 * @example
 * ```typescript
 * throw new CommandError(
 *   'Session not found',
 *   { suggestion: 'Start a session with: bdg <url>' },
 *   EXIT_CODES.RESOURCE_NOT_FOUND
 * );
 * ```
 */
export class CommandError extends Error {
  /**
   * Additional context for the error (suggestions, notes, etc.)
   */
  public readonly metadata: Record<string, string>;

  /**
   * Specific exit code for this error
   */
  public readonly exitCode: number;

  /**
   * Create a new CommandError
   *
   * @param message - Main error message
   * @param metadata - Additional context (suggestions, notes, etc.)
   * @param exitCode - Exit code to use when this error occurs
   */
  constructor(message: string, metadata: Record<string, string> = {}, exitCode: number = 1) {
    super(message);
    this.name = 'CommandError';
    this.metadata = metadata;
    this.exitCode = exitCode;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CommandError);
    }
  }
}
