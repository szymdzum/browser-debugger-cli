/**
 * Session cleanup operations.
 *
 * Handles cleanup of session files (PID, metadata, lock, socket).
 * WHY: Centralized cleanup logic ensures consistent cleanup across error paths and normal shutdown.
 */

import * as fs from 'fs';

import { acquireSessionLock, releaseSessionLock } from './lock.js';
import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { readPid, cleanupPidFile } from './pid.js';
import { isProcessAlive } from './process.js';

/**
 * Cleanup stale session files if no active session is running.
 *
 * Uses lock-based serialization to safely clean up orphaned session artifacts
 * (PID, metadata, socket) when the recorded process is dead or files are
 * missing/corrupt.
 *
 * WHY: Prevents accumulation of stale session files from crashed processes.
 *
 * @returns True if cleanup was performed, false if an active session is running
 *
 * @example
 * ```typescript
 * if (cleanupStaleSession()) {
 *   console.log('Cleaned up stale session files');
 * } else {
 *   console.log('Active session is running - no cleanup performed');
 * }
 * ```
 */
export function cleanupStaleSession(): boolean {
  ensureSessionDir();

  // Try to acquire the session lock
  const lockAcquired = acquireSessionLock();

  if (!lockAcquired) {
    // Lock is held by another process - check if it's still alive
    const lockPath = getSessionFilePath('LOCK');
    try {
      const lockPidStr = fs.readFileSync(lockPath, 'utf-8').trim();
      const lockPid = parseInt(lockPidStr, 10);

      if (!isNaN(lockPid) && isProcessAlive(lockPid)) {
        // Active session is running - don't clean up
        return false;
      }
    } catch {
      // Can't read lock file - will clean it up below
    }

    // Lock exists but process is dead - force acquire
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore if already deleted
    }

    // Try to acquire lock again
    if (!acquireSessionLock()) {
      // Still can't acquire - another process may have grabbed it
      return false;
    }
  }

  // We now hold the lock - check if session PID exists and is alive
  try {
    const sessionPid = readPid();

    // If session PID exists and process is alive, release lock and return
    if (sessionPid !== null && isProcessAlive(sessionPid)) {
      releaseSessionLock();
      return false;
    }

    // Check daemon PID if it exists
    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    if (fs.existsSync(daemonPidPath)) {
      try {
        const daemonPidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
        const daemonPid = parseInt(daemonPidStr, 10);

        // If daemon is still alive, release lock and return
        if (!isNaN(daemonPid) && isProcessAlive(daemonPid)) {
          releaseSessionLock();
          return false;
        }
      } catch {
        // Can't read daemon PID - will clean it up below
      }
    }

    // All processes are dead - clean up stale artifacts
    console.error('[cleanup] Removing stale session files...');

    // Remove session PID
    cleanupPidFile();

    // Remove metadata
    const metaPath = getSessionFilePath('METADATA');
    if (fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath);
        console.error('[cleanup] Removed metadata file');
      } catch (error) {
        console.error('[cleanup] Failed to remove metadata:', error);
      }
    }

    // Remove daemon PID
    if (fs.existsSync(daemonPidPath)) {
      try {
        fs.unlinkSync(daemonPidPath);
        console.error('[cleanup] Removed daemon PID file');
      } catch (error) {
        console.error('[cleanup] Failed to remove daemon PID:', error);
      }
    }

    // Remove daemon socket
    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
        console.error('[cleanup] Removed daemon socket');
      } catch (error) {
        console.error('[cleanup] Failed to remove daemon socket:', error);
      }
    }

    console.error('[cleanup] Stale session cleanup complete');

    return true;
  } finally {
    // Always release the lock
    releaseSessionLock();
  }
}

/**
 * Cleanup all session files after a session ends.
 *
 * Removes PID, lock, and metadata files.
 * Safe to call multiple times (idempotent).
 *
 * WHY: Ensures clean slate for next session, prevents stale file accumulation.
 */
export function cleanupSession(): void {
  cleanupPidFile();
  releaseSessionLock();

  const metaPath = getSessionFilePath('METADATA');
  if (fs.existsSync(metaPath)) {
    try {
      fs.unlinkSync(metaPath);
    } catch {
      // Ignore errors
    }
  }
}
