/**
 * Session cleanup operations.
 *
 * Handles cleanup of session files (PID, metadata, lock, socket).
 * WHY: Centralized cleanup logic ensures consistent cleanup across error paths and normal shutdown.
 */

import * as fs from 'fs';

import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';

import { readChromePid, clearChromePid } from './chrome.js';
import { safeDeleteFile } from './fileOps.js';
import { acquireSessionLock, releaseSessionLock } from './lock.js';
import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { readPid, cleanupPidFile } from './pid.js';
import { isProcessAlive, killChromeProcess } from './process.js';

const log = createLogger('cleanup');

function readPidFromFile(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const pidStr = fs.readFileSync(filePath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function killOrphanedWorker(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
    log(`Force killed orphaned worker process ${pid}`);
  } catch (error) {
    log(`Failed to kill orphaned worker process ${pid}: ${getErrorMessage(error)}`);
  }
}

function killCachedChromeProcess(reason: string): void {
  const chromePid = readChromePid();
  if (!chromePid) {
    return;
  }

  log(`Killing cached Chrome process ${chromePid} (${reason})`);

  let killSucceeded = false;
  try {
    killChromeProcess(chromePid, 'SIGKILL');
    killSucceeded = true;
  } catch (error) {
    log(`Failed to kill Chrome process ${chromePid}: ${getErrorMessage(error)}`);
  } finally {
    if (killSucceeded || !isProcessAlive(chromePid)) {
      clearChromePid();
    }
  }
}

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

  // We now hold the lock - check if session and daemon processes are alive
  try {
    const sessionPid = readPid();
    let sessionAlive = sessionPid !== null && isProcessAlive(sessionPid);

    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    const daemonPid = readPidFromFile(daemonPidPath);
    const daemonAlive = daemonPid !== null && isProcessAlive(daemonPid);

    if (sessionAlive && !daemonAlive && sessionPid !== null) {
      log(`Detected orphaned worker process (PID ${sessionPid}) with no daemon - forcing cleanup`);
      killCachedChromeProcess('orphaned worker cleanup');
      killOrphanedWorker(sessionPid);
      sessionAlive = isProcessAlive(sessionPid);
    }

    if (sessionAlive) {
      return false;
    }

    if (daemonAlive) {
      return false;
    }

    // All processes are dead - clean up stale artifacts
    log('Removing stale session files...');

    killCachedChromeProcess('stale session cleanup');

    // Remove session PID
    cleanupPidFile();

    // Remove all session files using helper
    safeDeleteFile(getSessionFilePath('METADATA'), 'metadata file', log);
    safeDeleteFile(daemonPidPath, 'daemon PID file', log);
    safeDeleteFile(getSessionFilePath('DAEMON_SOCKET'), 'daemon socket', log);
    safeDeleteFile(getSessionFilePath('DAEMON_LOCK'), 'daemon lock', log);

    log('Stale session cleanup complete');

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

/**
 * Cleanup stale daemon PID file if daemon process is dead.
 *
 * WHY: Prevents stale daemon PIDs from blocking new daemon starts (P0 Fix #2).
 *
 * @returns True if cleanup was performed, false if daemon is running
 */
export function cleanupStaleDaemonPid(): boolean {
  const daemonPidPath = getSessionFilePath('DAEMON_PID');
  if (!fs.existsSync(daemonPidPath)) {
    return false;
  }

  try {
    const daemonPidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
    const daemonPid = parseInt(daemonPidStr, 10);

    // If daemon is still alive, don't clean up
    if (!isNaN(daemonPid) && isProcessAlive(daemonPid)) {
      return false;
    }

    // Daemon is dead - clean up stale PID and lock files
    log(`Daemon not running (stale PID ${daemonPid}), cleaning up...`);

    // Remove daemon PID
    try {
      fs.unlinkSync(daemonPidPath);
      log('Removed stale daemon PID file');
    } catch (error) {
      log(`Failed to remove daemon PID: ${getErrorMessage(error)}`);
    }

    // Remove daemon socket
    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
        log('Removed stale daemon socket');
      } catch (error) {
        log(`Failed to remove daemon socket: ${getErrorMessage(error)}`);
      }
    }

    // Remove daemon lock
    const lockPath = getSessionFilePath('DAEMON_LOCK');
    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
        log('Removed stale daemon lock');
      } catch (error) {
        log(`Failed to remove daemon lock: ${getErrorMessage(error)}`);
      }
    }

    return true;
  } catch {
    // Can't read daemon PID - will clean it up
    try {
      fs.unlinkSync(daemonPidPath);
      return true;
    } catch {
      return false;
    }
  }
}
