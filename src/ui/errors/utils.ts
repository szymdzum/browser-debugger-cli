/**
 * Error utility functions.
 *
 * Helper functions for detecting specific error conditions in the CLI layer.
 */

import { getErrorMessage } from '@/connection/errors.js';

/**
 * Detect whether an error indicates the daemon/socket is unavailable.
 *
 * @param error - Error of unknown type
 * @returns True if error indicates daemon connection failure
 *
 * @example
 * ```typescript
 * try {
 *   await connectToDaemon();
 * } catch (error) {
 *   if (isDaemonConnectionError(error)) {
 *     console.error('Daemon not running. Start with: bdg <url>');
 *   }
 * }
 * ```
 */
export function isDaemonConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('ENOENT') || message.includes('ECONNREFUSED');
}
