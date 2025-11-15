/**
 * IPC Error Detection
 *
 * Utilities for detecting IPC transport-level errors.
 */

import { getErrorMessage } from '@/connection/errors.js';

/**
 * Detect whether an error indicates the daemon socket is unavailable.
 * Checks for ENOENT (socket file doesn't exist) and ECONNREFUSED (daemon not listening).
 *
 * @param error - Error from IPC transport layer
 * @returns True if error indicates daemon connection failure
 *
 * @example
 * ```typescript
 * try {
 *   await connectToDaemon();
 * } catch (error) {
 *   if (isConnectionError(error)) {
 *     console.error('Daemon not running. Start with: bdg <url>');
 *   }
 * }
 * ```
 */
export function isConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('ENOENT') || message.includes('ECONNREFUSED');
}
