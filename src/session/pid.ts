/**
 * Session PID file management.
 *
 * Handles reading/writing the main session PID file for tracking active sessions.
 * WHY: Centralized PID operations prevent inconsistencies in session tracking.
 */

import * as fs from 'fs';

import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { readPidFromFile } from '@/utils/validation.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';

/**
 * Write the current process PID to the session file atomically.
 *
 * Uses atomic write (tmp file + rename) to prevent corruption if process crashes.
 *
 * @param pid - Process ID to write
 *
 * @example
 * ```typescript
 * writePid(process.pid);
 * ```
 */
export function writePid(pid: number): void {
  ensureSessionDir();
  const pidPath = getSessionFilePath('PID');
  AtomicFileWriter.writeSync(pidPath, pid.toString());
}

/**
 * Read the PID from the session file.
 *
 * @returns The PID if file exists and is valid, null otherwise
 *
 * @example
 * ```typescript
 * const sessionPid = readPid();
 * if (sessionPid && isProcessAlive(sessionPid)) {
 *   console.log('Session is running');
 * }
 * ```
 */
export function readPid(): number | null {
  const pidPath = getSessionFilePath('PID');
  return readPidFromFile(pidPath);
}

/**
 * Remove the PID file.
 *
 * Safe to call multiple times (idempotent).
 */
export function cleanupPidFile(): void {
  const pidPath = getSessionFilePath('PID');

  if (fs.existsSync(pidPath)) {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // Ignore errors during cleanup
    }
  }
}
