/**
 * Session PID file management.
 *
 * Handles reading/writing the main session PID file for tracking active sessions.
 * WHY: Centralized PID operations prevent inconsistencies in session tracking.
 */

import * as fs from 'fs';

import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';

const log = createLogger('session');

/**
 * Read and parse a PID from a file.
 *
 * @param filePath - Path to the PID file
 * @returns Parsed PID or null if file doesn't exist or contains invalid data
 *
 * @example
 * ```typescript
 * const daemonPid = readPidFromFile('/path/to/daemon.pid');
 * if (daemonPid && isProcessAlive(daemonPid)) {
 *   console.log('Daemon is running');
 * }
 * ```
 */
export function readPidFromFile(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const pidStr = fs.readFileSync(filePath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (Number.isNaN(pid)) {
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

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

  try {
    fs.rmSync(pidPath, { force: true });
  } catch (error) {
    log.debug(`Failed to cleanup PID file: ${getErrorMessage(error)}`);
  }
}
