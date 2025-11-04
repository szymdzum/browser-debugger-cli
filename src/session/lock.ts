/**
 * Session lock management for preventing concurrent sessions.
 *
 * Uses exclusive file creation (wx flag) with PID tracking for atomic lock acquisition.
 * WHY: Prevents race conditions when multiple bdg processes try to start simultaneously.
 */

import * as fs from 'fs';

import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { isProcessAlive } from './process.js';

/**
 * Acquire session lock atomically.
 *
 * Uses exclusive file creation (wx flag) to ensure only one session can run.
 * If lock file exists but process is dead, automatically removes stale lock and retries.
 *
 * @returns True if lock was acquired, false if another session is running
 *
 * @example
 * ```typescript
 * if (!acquireSessionLock()) {
 *   console.error('Another session is already running');
 *   process.exit(1);
 * }
 * ```
 */
export function acquireSessionLock(): boolean {
  ensureSessionDir();
  const lockPath = getSessionFilePath('LOCK');

  try {
    // 'wx' flag creates file exclusively - fails if exists
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      // Lock file exists - check if process is still alive
      try {
        const lockPidStr = fs.readFileSync(lockPath, 'utf-8').trim();
        const lockPid = parseInt(lockPidStr, 10);

        if (!isNaN(lockPid) && isProcessAlive(lockPid)) {
          // Lock is held by active process
          return false;
        } else {
          // Stale lock file - remove it and try again
          fs.unlinkSync(lockPath);
          return acquireSessionLock();
        }
      } catch {
        // Can't read lock file - assume it's stale
        try {
          fs.unlinkSync(lockPath);
          return acquireSessionLock();
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}

/**
 * Release session lock.
 *
 * Removes the lock file to allow other sessions to start.
 * Safe to call multiple times (idempotent).
 */
export function releaseSessionLock(): void {
  const lockPath = getSessionFilePath('LOCK');

  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}
