/**
 * System-level error classes for bdg CLI.
 *
 * Provides structured error handling for low-level system operations
 * like CDP connections, Chrome launches, and timeouts.
 */

/**
 * Base error class for all bdg system errors.
 *
 * Extends native Error with:
 * - Error codes for programmatic handling
 * - Category for filtering (system/user/external)
 * - Exit code for semantic exit codes (80-99 user errors, 100-119 software errors)
 * - Cause chaining for nested errors
 */
export abstract class BdgError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'system' | 'user' | 'external';
  abstract readonly exitCode: number;

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
export class ChromeLaunchError extends BdgError {
  readonly code = 'CHROME_LAUNCH_ERROR';
  readonly category = 'system' as const;
  readonly exitCode = 100; // CHROME_LAUNCH_FAILURE
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
  readonly exitCode = 102; // CDP_TIMEOUT
}
