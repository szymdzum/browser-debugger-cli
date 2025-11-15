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
import { acquireSessionLock, releaseSessionLock } from './lock.js';
import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { readPid, cleanupPidFile, readPidFromFile } from './pid.js';
import { isProcessAlive, killChromeProcess } from './process.js';

const log = createLogger('cleanup');

function killOrphanedWorker(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
    log.info(`Force killed orphaned worker process ${pid}`);
  } catch (error) {
    log.info(`Failed to kill orphaned worker process ${pid}: ${getErrorMessage(error)}`);
  }
}

function killCachedChromeProcess(reason: string): void {
  const chromePid = readChromePid();
  if (!chromePid) {
    return;
  }

  log.info(`Killing cached Chrome process ${chromePid} (${reason})`);

  let killSucceeded = false;
  try {
    killChromeProcess(chromePid, 'SIGKILL');
    killSucceeded = true;
  } catch (error) {
    log.info(`Failed to kill Chrome process ${chromePid}: ${getErrorMessage(error)}`);
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

  const lockAcquired = acquireSessionLock();

  if (!lockAcquired) {
    const lockPath = getSessionFilePath('LOCK');
    try {
      const lockPidStr = fs.readFileSync(lockPath, 'utf-8').trim();
      const lockPid = parseInt(lockPidStr, 10);

      if (!Number.isNaN(lockPid) && isProcessAlive(lockPid)) {
        return false;
      }
    } catch (error) {
      log.debug(`Failed to read stale session lock: ${getErrorMessage(error)}`);
    }

    try {
      fs.rmSync(lockPath, { force: true });
    } catch (error) {
      log.debug(`Failed to remove stale session lock: ${getErrorMessage(error)}`);
    }

    if (!acquireSessionLock()) {
      return false;
    }
  }

  try {
    const sessionPid = readPid();
    let sessionAlive = sessionPid !== null && isProcessAlive(sessionPid);

    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    const daemonPid = readPidFromFile(daemonPidPath);
    const daemonAlive = daemonPid !== null && isProcessAlive(daemonPid);

    if (sessionAlive && !daemonAlive && sessionPid !== null) {
      log.info(
        `Detected orphaned worker process (PID ${sessionPid}) with no daemon - forcing cleanup`
      );
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

    log.info('Removing stale session files...');

    killCachedChromeProcess('stale session cleanup');

    cleanupPidFile();

    try {
      fs.rmSync(getSessionFilePath('METADATA'), { force: true });
    } catch (error) {
      log.debug(`Failed to remove metadata file: ${getErrorMessage(error)}`);
    }

    try {
      fs.rmSync(daemonPidPath, { force: true });
    } catch (error) {
      log.debug(`Failed to remove daemon PID file: ${getErrorMessage(error)}`);
    }

    try {
      fs.rmSync(getSessionFilePath('DAEMON_SOCKET'), { force: true });
    } catch (error) {
      log.debug(`Failed to remove daemon socket: ${getErrorMessage(error)}`);
    }

    try {
      fs.rmSync(getSessionFilePath('DAEMON_LOCK'), { force: true });
    } catch (error) {
      log.debug(`Failed to remove daemon lock: ${getErrorMessage(error)}`);
    }

    log.info('Stale session cleanup complete');

    return true;
  } finally {
    releaseSessionLock();
  }
}

/**
 * Cleanup all session files after a session ends.
 *
 * Removes session-specific files while preserving chrome-profile directory
 * which contains user preferences, cookies, and cached data.
 *
 * Files removed:
 * - session.pid (worker PID)
 * - session.lock (session lock)
 * - session.meta.json (session metadata)
 * - daemon.pid, daemon.sock, daemon.lock (daemon files)
 *
 * Files preserved:
 * - session.json (output file - user needs to read it)
 * - chrome.pid (for emergency cleanup - auto-removed if Chrome is dead)
 * - chrome-profile/ directory (cookies, preferences, cache)
 *
 * Safe to call multiple times (idempotent).
 *
 * WHY: Ensures clean slate for next session while preserving user preferences.
 */
export function cleanupSession(): void {
  // Clean up worker session files
  cleanupPidFile();
  releaseSessionLock();

  // Remove session metadata
  try {
    fs.rmSync(getSessionFilePath('METADATA'), { force: true });
  } catch (error) {
    log.debug(`Failed to remove metadata file: ${getErrorMessage(error)}`);
  }

  // NOTE: chrome.pid is intentionally NOT removed here
  // It's used for emergency cleanup (bdg cleanup --chrome)
  // and is automatically cleaned when Chrome process dies (via readChromePid)

  // Remove daemon files
  try {
    fs.rmSync(getSessionFilePath('DAEMON_PID'), { force: true });
  } catch (error) {
    log.debug(`Failed to remove daemon PID file: ${getErrorMessage(error)}`);
  }

  try {
    fs.rmSync(getSessionFilePath('DAEMON_SOCKET'), { force: true });
  } catch (error) {
    log.debug(`Failed to remove daemon socket: ${getErrorMessage(error)}`);
  }

  try {
    fs.rmSync(getSessionFilePath('DAEMON_LOCK'), { force: true });
  } catch (error) {
    log.debug(`Failed to remove daemon lock: ${getErrorMessage(error)}`);
  }

  // NOTE: session.json (OUTPUT) is intentionally NOT removed
  // User needs to read the output file after session ends
  // They can manually delete it or use `bdg cleanup` to remove all files

  // NOTE: chrome-profile/ directory is intentionally NOT removed
  // to preserve user preferences, cookies, and cached data across sessions
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

    if (!Number.isNaN(daemonPid) && isProcessAlive(daemonPid)) {
      return false;
    }

    log.info(`Daemon not running (stale PID ${daemonPid}), cleaning up...`);

    try {
      fs.rmSync(daemonPidPath, { force: true });
      log.info('Removed stale daemon PID file');
    } catch (error) {
      log.info(`Failed to remove daemon PID: ${getErrorMessage(error)}`);
    }

    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    if (fs.existsSync(socketPath)) {
      try {
        fs.rmSync(socketPath, { force: true });
        log.info('Removed stale daemon socket');
      } catch (error) {
        log.info(`Failed to remove daemon socket: ${getErrorMessage(error)}`);
      }
    }

    const lockPath = getSessionFilePath('DAEMON_LOCK');
    if (fs.existsSync(lockPath)) {
      try {
        fs.rmSync(lockPath, { force: true });
        log.info('Removed stale daemon lock');
      } catch (error) {
        log.info(`Failed to remove daemon lock: ${getErrorMessage(error)}`);
      }
    }

    return true;
  } catch {
    try {
      fs.rmSync(daemonPidPath, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
