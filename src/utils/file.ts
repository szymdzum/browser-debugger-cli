/**
 * File system utilities for safe file operations.
 *
 * Provides wrapper functions that handle errors gracefully and log failures
 * at debug level instead of throwing exceptions.
 */

import * as fs from 'fs';

import type { Logger } from '@/ui/logging/index.js';
import { logDebugError } from '@/ui/logging/index.js';

/**
 * Safely remove a file, logging any errors at debug level.
 *
 * Uses `fs.rmSync` with `force: true` to avoid errors if the file doesn't exist.
 * Any errors during removal are logged at debug level instead of thrown.
 *
 * @param path - Absolute path to the file to remove
 * @param context - Human-readable description for debug logging (e.g., "metadata file")
 * @param log - Logger instance to use for debug output
 * @returns True if file was removed or didn't exist, false if removal failed
 *
 * @example
 * ```typescript
 * const log = createLogger('cleanup');
 * safeRemoveFile('/path/to/session.pid', 'session PID file', log);
 * // On error logs: [cleanup] Failed to remove session PID file: EACCES: permission denied
 * ```
 */
export function safeRemoveFile(path: string, context: string, log: Logger): boolean {
  try {
    fs.rmSync(path, { force: true });
    return true;
  } catch (error) {
    logDebugError(log, `remove ${context}`, error);
    return false;
  }
}

/**
 * Safely remove a file if it exists, logging any errors at debug level.
 *
 * Checks file existence before attempting removal. Useful when you want to
 * distinguish between "file didn't exist" and "file existed but removal failed".
 *
 * @param path - Absolute path to the file to remove
 * @param context - Human-readable description for debug logging
 * @param log - Logger instance to use for debug output
 * @returns True if file was removed, false if it didn't exist or removal failed
 *
 * @example
 * ```typescript
 * const log = createLogger('cleanup');
 * if (safeRemoveFileIfExists('/path/to/lock', 'lock file', log)) {
 *   console.log('Lock file was removed');
 * }
 * ```
 */
export function safeRemoveFileIfExists(path: string, context: string, log: Logger): boolean {
  if (!fs.existsSync(path)) {
    return false;
  }
  return safeRemoveFile(path, context, log);
}
