/**
 * Structured IPC error classes.
 *
 * Provides type-safe error handling for IPC transport layer failures.
 */

import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Base class for all IPC-related errors.
 *
 * Extends Error to include exit codes for consistent CLI behavior.
 */
export class IPCError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT_CODES.SOFTWARE_ERROR) {
    super(message);
    this.name = 'IPCError';
    this.exitCode = exitCode;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IPCError);
    }
  }
}

/**
 * Error thrown when IPC connection to daemon fails.
 *
 * Indicates the daemon is not running or socket is unavailable.
 *
 * @example
 * ```typescript
 * throw new IPCConnectionError(
 *   'Failed to connect to daemon socket',
 *   '/Users/user/.bdg/daemon.sock',
 *   'ENOENT'
 * );
 * ```
 */
export class IPCConnectionError extends IPCError {
  public override readonly name = 'IPCConnectionError';
  public readonly socketPath: string;
  public readonly code?: string;

  constructor(message: string, socketPath: string, code?: string) {
    super(message, EXIT_CODES.RESOURCE_NOT_FOUND);
    this.socketPath = socketPath;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Error thrown when IPC request times out.
 *
 * Indicates the daemon received the request but didn't respond in time.
 *
 * @example
 * ```typescript
 * throw new IPCTimeoutError('worker_status', 5000);
 * ```
 */
export class IPCTimeoutError extends IPCError {
  public override readonly name = 'IPCTimeoutError';
  public readonly requestName: string;
  public readonly timeoutMs: number;

  constructor(requestName: string, timeoutMs: number) {
    super(`${requestName} request timeout after ${timeoutMs / 1000}s`, EXIT_CODES.CDP_TIMEOUT);
    this.requestName = requestName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error thrown when IPC response parsing fails.
 *
 * Indicates malformed JSON or unexpected response format.
 *
 * @example
 * ```typescript
 * throw new IPCParseError('worker_peek', 'Unexpected token in JSON');
 * ```
 */
export class IPCParseError extends IPCError {
  public override readonly name = 'IPCParseError';
  public readonly requestName: string;
  public override readonly cause?: Error;

  constructor(requestName: string, message: string, cause?: Error) {
    super(`Failed to parse ${requestName} response: ${message}`, EXIT_CODES.SOFTWARE_ERROR);
    this.requestName = requestName;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Error thrown when connection closes before response received.
 *
 * Indicates daemon crashed or was killed during request processing.
 *
 * @example
 * ```typescript
 * throw new IPCEarlyCloseError('worker_peek');
 * ```
 */
export class IPCEarlyCloseError extends IPCError {
  public override readonly name = 'IPCEarlyCloseError';
  public readonly requestName: string;

  constructor(requestName: string) {
    super(`Connection closed before ${requestName} response received`, EXIT_CODES.SOFTWARE_ERROR);
    this.requestName = requestName;
  }
}
