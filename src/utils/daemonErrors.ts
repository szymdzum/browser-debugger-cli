/**
 * Shared utilities for handling daemon connection errors in commands.
 *
 * Provides consistent error handling for peek, tail, and other commands
 * that communicate with the daemon via IPC.
 */

import { OutputBuilder } from '@/commands/shared/OutputBuilder.js';
import { noPreviewDataError } from '@/ui/messages/errors.js';
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
 * Handle daemon connection errors with consistent formatting and behavior.
 *
 * In JSON mode: outputs error as JSON
 * In follow mode: shows retry message and continues
 * In normal mode: exits with error code
 *
 * @param error - Error message to display
 * @param options - Error handling options
 *
 * @example
 * ```typescript
 * // One-time command (exits on error)
 * handleDaemonConnectionError('Daemon not running', {
 *   json: options.json,
 *   exitCode: EXIT_CODES.RESOURCE_NOT_FOUND
 * });
 *
 * // Follow mode (retries)
 * handleDaemonConnectionError('Connection lost', {
 *   json: options.json,
 *   follow: true,
 *   retryIntervalMs: 1000
 * });
 * ```
 */
export function handleDaemonConnectionError(error: string, options: DaemonErrorOptions): void {
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
    console.error(noPreviewDataError());
  }

  if (!follow) {
    process.exit(exitCode);
  } else {
    console.error(`\n[${timestamp}] ⚠️  Connection lost, retrying every ${retryMessage}...`);
    console.error('Press Ctrl+C to stop');
  }
}
