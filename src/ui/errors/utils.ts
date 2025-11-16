/**
 * Error utility functions.
 *
 * Helper functions for detecting specific error conditions in the CLI layer.
 *
 * @deprecated This module re-exports IPC utilities for backward compatibility.
 * Prefer importing from \@/ipc/utils/errors.js directly.
 */

import { isConnectionError } from '@/ipc/utils/errors.js';

/**
 * Detect whether an error indicates the daemon/socket is unavailable.
 *
 * @deprecated Use `isConnectionError` from \@/ipc/utils/errors.js instead.
 * This function is maintained for backward compatibility.
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
  return isConnectionError(error);
}
