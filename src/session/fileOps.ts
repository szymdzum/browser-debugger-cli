/**
 * File operation utilities for session management.
 *
 * Provides safe file operations with consistent error handling and logging.
 */

import * as fs from 'fs';

import { getErrorMessage } from '@/ui/errors/index.js';
import type { Logger } from '@/ui/logging/index.js';

/**
 * Safely delete a file if it exists.
 *
 * Handles missing files and errors gracefully with consistent logging.
 *
 * @param path - File path to delete
 * @param label - Human-readable label for logging
 * @param log - Logger instance
 * @returns True if file was deleted, false if it didn't exist or error occurred
 *
 * @example
 * ```typescript
 * const log = createLogger('session');
 * safeDeleteFile('/path/to/file.txt', 'config file', log);
 * // Logs: "Removed config file" or "Failed to remove config file: <error>"
 * ```
 */
export function safeDeleteFile(path: string, label: string, log: Logger): boolean {
  if (!fs.existsSync(path)) {
    return false;
  }

  try {
    fs.unlinkSync(path);
    log(`Removed ${label}`);
    return true;
  } catch (error) {
    log(`Failed to remove ${label}: ${getErrorMessage(error)}`);
    return false;
  }
}
