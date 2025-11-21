/**
 * Centralized IPC error-to-exit code mapping.
 *
 * Provides a single source of truth for mapping IPC error codes and connection
 * errors to semantic exit codes. This eliminates scattered, inconsistent error
 * handling across commands.
 *
 * WHY: Different commands had duplicate, inconsistent error-to-exit-code logic.
 * Some used helper functions, others used string matching. This module provides
 * consistent, maintainable error handling.
 */

import { IPCErrorCode } from '@/ipc/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Map IPC error codes to semantic exit codes.
 *
 * @param errorCode - IPC error code from daemon response
 * @returns Semantic exit code for the error
 *
 * @example
 * ```typescript
 * const exitCode = getExitCodeForIPCError(response.errorCode);
 * process.exit(exitCode);
 * ```
 */
export function getExitCodeForIPCError(errorCode?: IPCErrorCode): number {
  switch (errorCode) {
    case IPCErrorCode.NO_SESSION:
      return EXIT_CODES.RESOURCE_NOT_FOUND;

    case IPCErrorCode.SESSION_ALREADY_RUNNING:
      return EXIT_CODES.RESOURCE_ALREADY_EXISTS;

    case IPCErrorCode.CHROME_LAUNCH_FAILED:
      return EXIT_CODES.CHROME_LAUNCH_FAILURE;

    case IPCErrorCode.CDP_TIMEOUT:
      return EXIT_CODES.CDP_TIMEOUT;

    case IPCErrorCode.SESSION_KILL_FAILED:
    case IPCErrorCode.WORKER_START_FAILED:
    case IPCErrorCode.DAEMON_ERROR:
    case undefined:
      return EXIT_CODES.UNHANDLED_EXCEPTION;
  }
}

/**
 * Check if error indicates socket connection failure (daemon not running).
 */
function isSocketConnectionError(lowerMessage: string): boolean {
  return lowerMessage.includes('enoent') || lowerMessage.includes('econnrefused');
}

/**
 * Map connection error messages to semantic exit codes.
 *
 * Handles common socket and connection errors that indicate the daemon
 * is not running or unreachable.
 *
 * @param errorMessage - Error message string to analyze
 * @returns Semantic exit code for the error
 *
 * @example
 * ```typescript
 * try {
 *   await connectToDaemon();
 * } catch (error) {
 *   const exitCode = getExitCodeForConnectionError(getErrorMessage(error));
 *   process.exit(exitCode);
 * }
 * ```
 */
export function getExitCodeForConnectionError(errorMessage: string): number {
  const lowerMessage = errorMessage.toLowerCase();

  if (isSocketConnectionError(lowerMessage)) {
    return EXIT_CODES.RESOURCE_NOT_FOUND;
  }

  if (lowerMessage.includes('no active session')) {
    return EXIT_CODES.RESOURCE_NOT_FOUND;
  }

  if (lowerMessage.includes('timeout')) {
    return EXIT_CODES.CDP_TIMEOUT;
  }

  return EXIT_CODES.SESSION_FILE_ERROR;
}

/**
 * Check if an error message indicates the daemon is not running.
 *
 * @param errorMessage - Error message to check
 * @returns True if the error indicates daemon is not running
 *
 * @example
 * ```typescript
 * if (isDaemonNotRunningError(errorMessage)) {
 *   console.error('Start a session first with: bdg <url>');
 * }
 * ```
 */
export function isDaemonNotRunningError(errorMessage: string): boolean {
  return isSocketConnectionError(errorMessage.toLowerCase());
}
