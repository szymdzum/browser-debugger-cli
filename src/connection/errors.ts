/**
 * Connection layer error classes.
 *
 * Provides structured error handling for CDP connections and Chrome launches.
 */

import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Base error class for all connection-related errors.
 *
 * Extends native Error with error codes for programmatic handling,
 * exit codes for semantic exit codes, and cause chaining for nested errors.
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
  readonly exitCode = EXIT_CODES.CDP_CONNECTION_FAILURE;
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
  readonly exitCode = EXIT_CODES.CHROME_LAUNCH_FAILURE;
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
  readonly exitCode = EXIT_CODES.CDP_TIMEOUT;
}

/**
 * Extract error message from unknown error type.
 *
 * @deprecated Import from \@/utils/errors.ts instead.
 * Re-exported for backward compatibility.
 */
export { getErrorMessage } from '@/utils/errors.js';
