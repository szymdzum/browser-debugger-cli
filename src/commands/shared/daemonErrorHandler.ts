/**
 * Shared utilities for handling daemon connection errors in commands.
 */

import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { genericError } from '@/ui/messages/errors.js';
import {
  connectionLostRetryMessage,
  connectionLostStopHintMessage,
} from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Options for daemon connection error handling. */
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

/** Result of handling a daemon connection error. */
export interface DaemonErrorResult {
  /** Whether the process should exit */
  shouldExit: boolean;
  /** Exit code to use if exiting */
  exitCode?: number;
}

/**
 * Handle daemon connection errors with consistent formatting and behavior.
 *
 * @param error - Error message to display
 * @param options - Error handling options
 * @returns Result indicating whether to exit
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
