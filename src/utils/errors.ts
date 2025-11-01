/**
 * Custom error classes for bdg CLI.
 *
 * Provides structured error handling with error codes and categorization
 * for better debugging and user-friendly error messages.
 */

/**
 * Base error class for all bdg errors.
 *
 * Extends native Error with:
 * - Error codes for programmatic handling
 * - Category for filtering (system/user/external)
 * - Cause chaining for nested errors
 */
export abstract class BdgError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'system' | 'user' | 'external';

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
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
export class CDPConnectionError extends BdgError {
  readonly code = 'CDP_CONNECTION_ERROR';
  readonly category = 'external' as const;
}

/**
 * Chrome launch failed.
 *
 * Examples:
 * - Chrome binary not found
 * - Insufficient permissions
 * - Port already in use
 */
export class ChromeLaunchError extends BdgError {
  readonly code = 'CHROME_LAUNCH_ERROR';
  readonly category = 'system' as const;
}

/**
 * CDP command timed out.
 *
 * Examples:
 * - Command took longer than 30s
 * - Browser became unresponsive
 */
export class CDPTimeoutError extends BdgError {
  readonly code = 'CDP_TIMEOUT_ERROR';
  readonly category = 'external' as const;
}

/**
 * Invalid URL provided.
 *
 * Examples:
 * - Malformed URL syntax
 * - Missing required URL components
 */
export class InvalidURLError extends BdgError {
  readonly code = 'INVALID_URL_ERROR';
  readonly category = 'user' as const;
}

/**
 * Session file operation failed.
 *
 * Examples:
 * - Cannot write to ~/.bdg/
 * - Disk full
 * - Permission denied
 */
export class SessionFileError extends BdgError {
  readonly code = 'SESSION_FILE_ERROR';
  readonly category = 'system' as const;
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
