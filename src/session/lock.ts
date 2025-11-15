/**
 * Session lock management for preventing concurrent sessions.
 *
 * Uses exclusive file creation (wx flag) with PID tracking for atomic lock acquisition.
 * WHY: Prevents race conditions when multiple bdg processes try to start simultaneously.
 */

import * as fs from 'fs';

import { getErrorMessage } from '@/connection/errors.js';
import { createLogger } from '@/ui/logging/index.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { isProcessAlive } from './process.js';

const log = createLogger('session');

type LockFile = 'LOCK' | 'DAEMON_LOCK';

/**
 * Type guard for NodeJS errno exceptions.
 *
 * @param e - Unknown error to check
 * @returns True if error has errno code property
 */
function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

/**
 * Read PID from lock file.
 *
 * @param lockPath - Path to lock file
 * @returns Parsed PID or null if file doesn't exist or is invalid
 */
function readLockPid(lockPath: string): number | null {
  try {
    const lockPidStr = fs.readFileSync(lockPath, 'utf-8').trim();
    const lockPid = parseInt(lockPidStr, 10);
    return Number.isNaN(lockPid) ? null : lockPid;
  } catch {
    return null;
  }
}

/**
 * Try to remove stale lock file.
 *
 * @param lockPath - Path to lock file to remove
 * @returns True if removal succeeded, false otherwise
 */
function removeStaleLock(lockPath: string): boolean {
  try {
    fs.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle existing lock file by checking if owner process is still alive.
 *
 * @param lockPath - Path to existing lock file
 * @param file - Lock file type for retry
 * @returns True if lock was acquired after removing stale lock, false if active lock exists
 */
function handleExistingLock(lockPath: string, file: LockFile): boolean {
  const lockPid = readLockPid(lockPath);

  if (lockPid !== null && isProcessAlive(lockPid)) {
    return false;
  }

  if (!removeStaleLock(lockPath)) {
    return false;
  }

  return acquireLock(file);
}

/**
 * Acquire a lock file atomically.
 *
 * Uses exclusive file creation (wx flag) to ensure only one process can hold the lock.
 * If lock exists but owner process is dead, automatically removes stale lock and retries.
 *
 * @param file - Lock file type to acquire
 * @returns True if lock was acquired, false if another process holds it
 */
function acquireLock(file: LockFile): boolean {
  ensureSessionDir();
  const lockPath = getSessionFilePath(file);

  try {
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'EEXIST') {
      return handleExistingLock(lockPath, file);
    }
    return false;
  }
}

/**
 * Release a lock file.
 *
 * @param file - Lock file type to release
 */
function releaseLock(file: LockFile): void {
  const lockPath = getSessionFilePath(file);
  try {
    fs.rmSync(lockPath, { force: true });
  } catch (error) {
    log.debug(`Failed to release lock file ${file}: ${getErrorMessage(error)}`);
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
