/**
 * Session cleanup operations.
 *
 * Handles cleanup of session files (PID, metadata, lock, socket).
 * WHY: Centralized cleanup logic ensures consistent cleanup across error paths and normal shutdown.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { getErrorMessage } from '@/connection/errors.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { safeRemoveFile } from '@/utils/file.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

import { readChromePid, clearChromePid } from './chrome.js';
import { acquireSessionLock, releaseSessionLock } from './lock.js';
import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { readPid, cleanupPidFile, readPidFromFile } from './pid.js';
import { clearSessionQueryCache } from './queryCache.js';

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
 * Find all orphaned daemon processes and return their PIDs.
 *
 * Orphaned daemons are node processes running dist/daemon.js that are not
 * the currently tracked daemon in the PID file.
 *
 * @returns Array of orphaned daemon PIDs
 */
async function findOrphanedDaemons(): Promise<number[]> {
  const orphanedPids: number[] = [];

  try {
    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    const currentDaemonPid = readPidFromFile(daemonPidPath);

    const psCommand =
      process.platform === 'win32'
        ? 'wmic process where "commandline like \'%dist/daemon.js%\'" get processid'
        : 'ps aux | grep -E "node.*dist/daemon\\.js" | grep -v grep';

    const { stdout: output } = await execAsync(psCommand);

    const lines = output.trim().split('\n');

    for (const line of lines) {
      let pid: number;

      if (process.platform === 'win32') {
        const match = line.trim().match(/(\d+)/);
        if (!match?.[1]) {
          continue;
        }
        pid = parseInt(match[1], 10);
      } else {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2 || !parts[1]) {
          continue;
        }
        pid = parseInt(parts[1], 10);
      }

      if (Number.isNaN(pid)) {
        continue;
      }

      if (currentDaemonPid && pid === currentDaemonPid) {
        continue;
      }

      if (isProcessAlive(pid)) {
        orphanedPids.push(pid);
      }
    }
  } catch (error) {
    logDebugError(log, 'find orphaned daemons', error);
  }

  return orphanedPids;
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
      logDebugError(log, 'read stale session lock', error);
    }

    safeRemoveFile(lockPath, 'stale session lock', log);

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

    safeRemoveFile(getSessionFilePath('METADATA'), 'metadata file', log);
    safeRemoveFile(daemonPidPath, 'daemon PID file', log);
    safeRemoveFile(getSessionFilePath('DAEMON_SOCKET'), 'daemon socket', log);
    safeRemoveFile(getSessionFilePath('DAEMON_LOCK'), 'daemon lock', log);

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
  cleanupPidFile();
  releaseSessionLock();

  safeRemoveFile(getSessionFilePath('METADATA'), 'metadata file', log);
  safeRemoveFile(getSessionFilePath('DAEMON_PID'), 'daemon PID file', log);
  safeRemoveFile(getSessionFilePath('DAEMON_SOCKET'), 'daemon socket', log);
  safeRemoveFile(getSessionFilePath('DAEMON_LOCK'), 'daemon lock', log);

  void clearSessionQueryCache();
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

/**
 * Aggressively cleanup orphaned daemon processes.
 *
 * Finds and kills all node processes running dist/daemon.js that are not
 * the currently tracked daemon. This prevents accumulation of zombie daemon
 * processes from test failures, timeouts, or crashes.
 *
 * WHY: Stale daemon processes accumulate from test runs and failures, causing
 * resource leaks and confusion. Aggressive cleanup prevents this.
 *
 * @returns Number of orphaned daemons killed
 *
 * @example
 * ```typescript
 * const killedCount = cleanupOrphanedDaemons();
 * if (killedCount > 0) {
 *   console.log(`Killed ${killedCount} orphaned daemon process(es)`);
 * }
 * ```
 */
export async function cleanupOrphanedDaemons(): Promise<number> {
  const orphanedPids = await findOrphanedDaemons();

  if (orphanedPids.length === 0) {
    log.debug('No orphaned daemon processes found');
    return 0;
  }

  log.info(`Found ${orphanedPids.length} orphaned daemon process(es): ${orphanedPids.join(', ')}`);

  let killedCount = 0;

  for (const pid of orphanedPids) {
    try {
      process.kill(pid, 'SIGKILL');
      log.info(`Killed orphaned daemon process ${pid}`);
      killedCount++;
    } catch (error) {
      logDebugError(log, `kill orphaned daemon ${pid}`, error);
    }
  }

  return killedCount;
}
