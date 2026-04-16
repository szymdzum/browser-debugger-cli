/**
 * Pre-start cleanup: runs BEFORE a daemon is launched.
 *
 * Invariants at this phase:
 * - No daemon is (yet) running in this process.
 * - File-based locks are the only coordination mechanism.
 * - Safe to remove shared daemon files if the recorded daemon is dead.
 *
 * Keep phase-scoped helpers in this module; runtime cleanup (while the daemon
 * is alive) lives in `runtime.ts`, end-of-session cleanup lives in
 * `postSession.ts`.
 */

import * as fs from 'fs';

import { killCachedChromeProcess, killOrphanedWorker } from '@/session/cleanup/primitives.js';
import { acquireSessionLock, releaseSessionLock } from '@/session/lock.js';
import { getSessionFilePath, ensureSessionDir } from '@/session/paths.js';
import { cleanupPidFile, readPid, readPidFromFile } from '@/session/pid.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { safeRemoveFile } from '@/utils/file.js';
import { isProcessAlive } from '@/utils/process.js';

const log = createLogger('cleanup');

/**
 * Cleanup stale session files if no active session is running.
 *
 * Uses lock-based serialization to safely clean up orphaned session artifacts
 * (PID, metadata, socket) when the recorded process is dead or files are
 * missing/corrupt.
 *
 * @returns True if cleanup was performed, false if an active session is running
 */
export function cleanupBeforeDaemonStart(): boolean {
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

    log.debug('Removing stale session files...');

    killCachedChromeProcess('stale session cleanup');

    cleanupPidFile();

    safeRemoveFile(getSessionFilePath('METADATA'), 'metadata file', log);
    safeRemoveFile(daemonPidPath, 'daemon PID file', log);
    safeRemoveFile(getSessionFilePath('DAEMON_SOCKET'), 'daemon socket', log);
    safeRemoveFile(getSessionFilePath('DAEMON_LOCK'), 'daemon lock', log);

    log.debug('Stale session cleanup complete');

    return true;
  } finally {
    releaseSessionLock();
  }
}

/**
 * Cleanup stale daemon artifacts (PID file, socket, lock) if the recorded
 * daemon process is dead.
 *
 * Called from `bdg status` to keep a fresh daemon startable without a
 * separate cleanup command.
 *
 * @returns True if cleanup was performed, false if daemon is running
 */
export function cleanupStaleDaemonArtifacts(): boolean {
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
