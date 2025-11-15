/**
 * Session lock management for preventing concurrent sessions.
 *
 * Uses exclusive file creation (wx flag) with PID tracking for atomic lock acquisition.
 * WHY: Prevents race conditions when multiple bdg processes try to start simultaneously.
 */

import * as fs from 'fs';

import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { isProcessAlive } from './process.js';

type LockFile = 'LOCK' | 'DAEMON_LOCK';

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

function acquireLock(file: LockFile): boolean {
  ensureSessionDir();
  const lockPath = getSessionFilePath(file);

  try {
    // 'wx' flag creates file exclusively - fails if exists
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'EEXIST') {
      // Lock file exists - check if process is still alive
      try {
        const lockPidStr = fs.readFileSync(lockPath, 'utf-8').trim();
        const lockPid = parseInt(lockPidStr, 10);

        if (!Number.isNaN(lockPid) && isProcessAlive(lockPid)) {
          // Lock is held by active process
          return false;
        } else {
          // Stale lock file - remove it and try again
          fs.rmSync(lockPath, { force: true });
          return acquireLock(file);
        }
      } catch {
        // Can't read lock file - assume it's stale
        try {
          fs.rmSync(lockPath, { force: true });
          return acquireLock(file);
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}

function releaseLock(file: LockFile): void {
  const lockPath = getSessionFilePath(file);
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // Ignore errors during cleanup
  }
}

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
  return acquireLock('LOCK');
}

/**
 * Release session lock.
 *
 * Removes the lock file to allow other sessions to start.
 * Safe to call multiple times (idempotent).
 */
export function releaseSessionLock(): void {
  releaseLock('LOCK');
}

/**
 * Acquire daemon lock atomically.
 *
 * Uses exclusive file creation (wx flag) to ensure only one daemon can start.
 * If lock file exists but process is dead, automatically removes stale lock and retries.
 *
 * WHY: Prevents race condition where two concurrent bdg commands spawn 2 daemons.
 *
 * @returns True if lock was acquired, false if another daemon startup is in progress
 *
 * @example
 * ```typescript
 * if (!acquireDaemonLock()) {
 *   console.error('Another daemon is starting up');
 *   process.exit(1);
 * }
 * ```
 */
export function acquireDaemonLock(): boolean {
  return acquireLock('DAEMON_LOCK');
}

/**
 * Release daemon lock.
 *
 * Removes the daemon lock file to allow other daemon startups.
 * Safe to call multiple times (idempotent).
 */
export function releaseDaemonLock(): void {
  releaseLock('DAEMON_LOCK');
}
