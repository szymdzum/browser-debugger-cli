/**
 * Connection layer error classes.
 *
 * Provides structured error handling for CDP connections and Chrome launches.
 */

/**
 * Base error class for all connection-related errors.
 *
 * Extends native Error with:
 * - Error codes for programmatic handling
 * - Exit code for semantic exit codes
 * - Cause chaining for nested errors
 */
export abstract class ConnectionError extends Error {
  abstract readonly code: string;
  abstract readonly exitCode: number;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * CDP connection failed (network/protocol issues).
 *
 * Examples:
 * - WebSocket connection refused
 * - Chrome not running on specified port
 * - Protocol version mismatch
 */
export class CDPConnectionError extends ConnectionError {
  readonly code = 'CDP_CONNECTION_ERROR';
  readonly exitCode = 101; // CDP_CONNECTION_FAILURE
}

/**
 * Chrome launch failed.
 *
 * Examples:
 * - Chrome binary not found
 * - Insufficient permissions
 * - Port already in use
 */
export class ChromeLaunchError extends ConnectionError {
  readonly code = 'CHROME_LAUNCH_ERROR';
  readonly exitCode = 100; // CHROME_LAUNCH_FAILURE
}

/**
 * CDP command timed out.
 *
 * Examples:
 * - Command took longer than 30s
 * - Browser became unresponsive
 */
export class CDPTimeoutError extends ConnectionError {
  readonly code = 'CDP_TIMEOUT_ERROR';
  readonly exitCode = 102; // CDP_TIMEOUT
}

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
