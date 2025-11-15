/**
 * Shared utilities for handling daemon connection errors in commands.
 *
 * Provides consistent error handling for peek, tail, and other commands
 * that communicate with the daemon via IPC.
 */

import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { genericError } from '@/ui/messages/errors.js';
import {
  connectionLostRetryMessage,
  connectionLostStopHintMessage,
} from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for daemon connection error handling.
 */
export interface DaemonErrorOptions {
  /** Use JSON output format */
  json?: boolean | undefined;
  /** Follow/watch mode (don't exit, show retry message) */
  follow?: boolean | undefined;
  /** Retry interval in milliseconds (for display message) */
  retryIntervalMs?: number | undefined;
  /** Custom exit code (defaults to RESOURCE_NOT_FOUND) */
  exitCode?: number | undefined;
}

/**
 * Result of handling a daemon connection error.
 */
export interface DaemonErrorResult {
  /** Whether the process should exit */
  shouldExit: boolean;
  /** Exit code to use if exiting */
  exitCode?: number;
}

/**
 * Handle daemon connection errors with consistent formatting and behavior.
 *
 * Formats and logs the error appropriately based on output mode.
 * Returns whether the caller should exit and with what code.
 *
 * @param error - Error message to display
 * @param options - Error handling options
 * @returns Result indicating whether to exit
 *
 * @example
 * ```typescript
 * // One-time command
 * const result = handleDaemonConnectionError('Daemon not running', {
 *   json: options.json,
 *   exitCode: EXIT_CODES.RESOURCE_NOT_FOUND
 * });
 * if (result.shouldExit) {
 *   process.exit(result.exitCode);
 * }
 *
 * // Follow mode (retries)
 * handleDaemonConnectionError('Connection lost', {
 *   json: options.json,
 *   follow: true,
 *   retryIntervalMs: 1000
 * });
 * // Returns { shouldExit: false }
 * ```
 */
export function handleDaemonConnectionError(
  error: string,
  options: DaemonErrorOptions
): DaemonErrorResult {
  const {
    json = false,
    follow = false,
    retryIntervalMs = 1000,
    exitCode = EXIT_CODES.RESOURCE_NOT_FOUND,
  } = options;

  const retryMessage =
    retryIntervalMs >= 1000 ? `${retryIntervalMs / 1000}s` : `${retryIntervalMs}ms`;

  const timestamp = new Date().toISOString();

  if (json) {
    console.log(JSON.stringify(OutputBuilder.buildJsonError(error, { exitCode }), null, 2));
  } else {
    console.error(genericError(error));
  }

  if (!follow) {
    return { shouldExit: true, exitCode };
  }

  console.error(connectionLostRetryMessage(timestamp, retryMessage));
  console.error(connectionLostStopHintMessage());
  return { shouldExit: false };
}
