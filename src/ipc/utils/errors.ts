/**
 * IPC Error Detection
 *
 * Utilities for detecting IPC transport-level errors.
 */

import { IPCConnectionError } from '@/ipc/transport/IPCError.js';
import { getErrorMessage } from '@/utils/errors.js';

/** A failed socket connection or an IPC connection error (not a file error) */
const DAEMON_CONNECTION_PATTERN = /IPC .+ connection error|\bconnect (ENOENT|ECONNREFUSED)\b/;

/**
 * Detect whether an error indicates the daemon socket is unavailable:
 * the socket file doesn't exist (ENOENT) or nobody listens (ECONNREFUSED).
 * Errors of other files (e.g. a screenshot path in a missing directory) are
 * not connection errors, even though they also say ENOENT.
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
  if (error instanceof IPCConnectionError) return true;
  return DAEMON_CONNECTION_PATTERN.test(getErrorMessage(error));
}
