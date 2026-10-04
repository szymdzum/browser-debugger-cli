/**
 * Connection layer error classes.
 *
 * Provides structured error handling for CDP connections and Chrome launches.
 */

import type { IssueDetails } from '@/errors/issues.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options accepted by ConnectionError subclasses.
 */
export interface ConnectionErrorOptions {
  /** Underlying error that triggered this one. */
  cause?: Error;
  /** Structured issue payload for boundary formatters. */
  issue?: IssueDetails;
}

/**
 * Base error class for all connection-related errors.
 *
 * Extends native Error with error codes for programmatic handling,
 * exit codes for semantic exit codes, and cause chaining for nested errors.
 * Optionally carries a structured {@link IssueDetails} payload so callers at
 * the UI boundary can format messages deterministically.
 */
export abstract class ConnectionError extends Error {
  abstract readonly code: string;
  abstract readonly exitCode: number;
  readonly issue?: IssueDetails;

  constructor(message: string, options?: ConnectionErrorOptions | Error) {
    super(message);
    this.name = this.constructor.name;

    if (options instanceof Error) {
      this.cause = options;
      return;
    }

    if (options?.cause) {
      this.cause = options.cause;
    }
    if (options?.issue) {
      this.issue = options.issue;
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

/** JSON-RPC error codes that mean the request itself was wrong */
const REQUEST_ERROR_CODES = new Set([-32600, -32601, -32602]);

/**
 * An error Chrome returned for a CDP command (e.g. invalid parameters, no
 * node with the given id), with its JSON-RPC code and detail.
 */
export class CDPProtocolError extends Error {
  override readonly name = 'CDPProtocolError';

  /**
   * @param message - Chrome's error message
   * @param code - JSON-RPC error code
   * @param data - Chrome's detail (e.g. which parameter is missing)
   */
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly data: string | undefined
  ) {
    super(data ? `${message}: ${data}` : message);
  }

  /**
   * Whether the command itself was wrong (method or parameters), as opposed
   * to failing on the page's state.
   *
   * @returns True for a user error
   */
  isRequestError(): boolean {
    return this.code !== undefined && REQUEST_ERROR_CODES.has(this.code);
  }
}
