/**
 * Session cleanup operations.
 *
 * Handles cleanup of session files (PID, metadata, lock, socket).
 * WHY: Centralized cleanup logic ensures consistent cleanup across error paths and normal shutdown.
 */

import * as fs from 'fs';

import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { safeRemoveFile } from '@/utils/file.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

import { QueryCacheManager } from './QueryCacheManager.js';
import { readChromePid, clearChromePid } from './chrome.js';
import { cleanupOrphanedDaemons } from './cleanup/orphanedDaemons.js';
import { acquireSessionLock, releaseSessionLock } from './lock.js';
import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { readPid, cleanupPidFile, readPidFromFile } from './pid.js';

export { cleanupOrphanedDaemons } from './cleanup/orphanedDaemons.js';
// Note: QueryCacheManager must be after chrome.js per alphabetical order

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
 * Force-recover a stale session while the daemon is still running.
 *
 * Unlike `cleanupStaleSession`, this helper is safe to call from inside the
 * daemon when its worker's CDP connection has died but the worker process may
 * still be alive. It terminates the worker (and bdg-launched Chrome, if any)
 * and clears only the session-scoped files, leaving daemon files intact so
 * the daemon can immediately start a fresh session.
 *
 * WHY: Fix for #221 — daemon must recover from dead CDP state rather than
 * reusing a stale `webSocketDebuggerUrl` from a previous launch.
 *
 * @param workerPid - Worker process ID to terminate
 * @param chromePid - Optional Chrome PID (only set when bdg launched Chrome)
 */
export async function forceRecoverStaleSession(
  workerPid: number,
  chromePid?: number
): Promise<void> {
  try {
    process.kill(workerPid, 'SIGKILL');
    log.info(`Stale session recovery: SIGKILL sent to worker PID ${workerPid}`);
  } catch (error) {
    log.debug(`Worker PID ${workerPid} could not be signaled: ${getErrorMessage(error)}`);
  }

  if (chromePid) {
    try {
      killChromeProcess(chromePid, 'SIGKILL');
      log.info(`Stale session recovery: SIGKILL sent to Chrome PID ${chromePid}`);
    } catch (error) {
      log.debug(`Chrome PID ${chromePid} could not be signaled: ${getErrorMessage(error)}`);
    }
  }

  cleanupPidFile();
  safeRemoveFile(getSessionFilePath('METADATA'), 'stale metadata', log);

  try {
    await QueryCacheManager.getInstance().clear();
  } catch (error) {
    logDebugError(log, 'clear stale query cache', error);
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

  void QueryCacheManager.getInstance()
    .clear()
    .catch((error) => {
      logDebugError(log, 'clear query cache', error);
    });
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
 * Options for unified session cleanup.
 */
export interface SessionCleanupOptions {
  /** Kill the associated Chrome process. */
  killChrome?: boolean | undefined;
  /** Force cleanup even if session appears active. */
  force?: boolean | undefined;
  /** Aggressively kill all orphaned processes. */
  aggressive?: boolean | undefined;
  /** Also remove the session.json output file. */
  removeOutput?: boolean | undefined;
  /** Chrome PID from daemon response (for stop command). */
  chromePid?: number | undefined;
}

/**
 * Result of session cleanup operation.
 */
export interface SessionCleanupResult {
  /** What was cleaned up. */
  cleaned: {
    /** Session files (PID, metadata, socket, lock). */
    session: boolean;
    /** Chrome browser process. */
    chrome: boolean;
    /** Orphaned daemon processes. */
    daemons: boolean;
    /** Session output file (session.json). */
    output: boolean;
  };
  /** Number of orphaned daemons killed. */
  orphanedDaemonsCount: number;
  /** Warnings encountered during cleanup. */
  warnings: string[];
}

/**
 * Mutable state accumulator for cleanup operations.
 */
interface CleanupState {
  warnings: string[];
  sessionCleaned: boolean;
  chromeCleaned: boolean;
  daemonsCleaned: boolean;
  outputCleaned: boolean;
  orphanedDaemonsCount: number;
}

function createCleanupState(): CleanupState {
  return {
    warnings: [],
    sessionCleaned: false,
    chromeCleaned: false,
    daemonsCleaned: false,
    outputCleaned: false,
    orphanedDaemonsCount: 0,
  };
}

/**
 * Kill a specific Chrome process by PID.
 */
function cleanupChromeProcess(
  chromePid: number,
  clearChromePid: () => void,
  state: CleanupState
): void {
  try {
    killChromeProcess(chromePid, 'SIGTERM');
    state.chromeCleaned = true;
    clearChromePid();
  } catch (error: unknown) {
    state.warnings.push(`Could not kill Chrome: ${getErrorMessage(error)}`);
  }
}

/**
 * Clean up stale daemon PID file and update state.
 */
function cleanupDaemonPidIfStale(state: CleanupState): void {
  const daemonPidPath = getSessionFilePath('DAEMON_PID');
  if (!fs.existsSync(daemonPidPath)) {
    return;
  }

  try {
    const daemonPidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
    const daemonPid = parseInt(daemonPidStr, 10);

    if (Number.isNaN(daemonPid) || !isProcessAlive(daemonPid)) {
      log.info(`Removing stale daemon PID file (PID ${daemonPid})`);
      fs.unlinkSync(daemonPidPath);
      state.sessionCleaned = true;
    }
  } catch {
    try {
      fs.unlinkSync(daemonPidPath);
      state.sessionCleaned = true;
    } catch (removeError) {
      state.warnings.push(`Could not remove daemon.pid: ${getErrorMessage(removeError)}`);
    }
  }
}

/**
 * Clean up active session, optionally forcing cleanup if still running.
 */
async function cleanupActiveSession(
  force: boolean,
  cleanupStaleChrome: () => Promise<number>,
  state: CleanupState
): Promise<void> {
  const sessionPid = readPid();
  if (!sessionPid) {
    return;
  }

  const isAlive = isProcessAlive(sessionPid);
  if (isAlive && !force) {
    return;
  }

  if (isAlive && force) {
    state.warnings.push(`Process ${sessionPid} is still running but forcing cleanup anyway`);
    log.info(`Force cleanup: killing Chrome for active session ${sessionPid}`);

    try {
      await cleanupStaleChrome();
      state.chromeCleaned = true;
    } catch (error) {
      state.warnings.push(`Could not kill Chrome processes: ${getErrorMessage(error)}`);
    }
  }

  cleanupSession();
  state.sessionCleaned = true;
}

/**
 * Clean up session output file.
 */
function cleanupOutputFile(state: CleanupState): void {
  const outputPath = getSessionFilePath('OUTPUT');
  if (!fs.existsSync(outputPath)) {
    return;
  }

  try {
    fs.unlinkSync(outputPath);
    state.outputCleaned = true;
  } catch (error: unknown) {
    state.warnings.push(`Could not remove session.json: ${getErrorMessage(error)}`);
  }
}

/**
 * Unified session cleanup for stop and cleanup commands.
 *
 * Consolidates cleanup logic from stop.ts and cleanup.ts into a single
 * reusable function. Handles Chrome processes, daemon PIDs, session files,
 * and orphaned processes.
 *
 * @param options - Cleanup options
 * @returns Cleanup result with what was cleaned and any warnings
 *
 * @example
 * ```typescript
 * // From stop command
 * const result = await performSessionCleanup({
 *   killChrome: opts.killChrome,
 *   chromePid: response.chromePid,
 * });
 *
 * // From cleanup command
 * const result = await performSessionCleanup({
 *   force: true,
 *   aggressive: true,
 *   removeOutput: true,
 * });
 * ```
 */
export async function performSessionCleanup(
  options: SessionCleanupOptions
): Promise<SessionCleanupResult> {
  const { cleanupStaleChrome, clearChromePid } = await import('./chrome.js');
  const state = createCleanupState();

  if (options.aggressive) {
    const daemonsKilled = await cleanupOrphanedDaemons();
    if (daemonsKilled > 0) {
      state.daemonsCleaned = true;
      state.orphanedDaemonsCount = daemonsKilled;
      console.error(`✓ Killed ${daemonsKilled} orphaned daemon process(es)`);
    }

    const errorCount = await cleanupStaleChrome();
    state.chromeCleaned = true;
    if (errorCount > 0) {
      state.warnings.push('Some Chrome processes could not be killed');
    }
  }

  if (options.killChrome && options.chromePid) {
    cleanupChromeProcess(options.chromePid, clearChromePid, state);
  } else if (options.killChrome && !options.chromePid) {
    state.warnings.push('Chrome PID not found (Chrome was not launched by bdg)');
  }

  cleanupDaemonPidIfStale(state);
  await cleanupActiveSession(options.force ?? false, cleanupStaleChrome, state);

  if (!options.aggressive) {
    const daemonsKilled = await cleanupOrphanedDaemons();
    if (daemonsKilled > 0) {
      state.daemonsCleaned = true;
      state.orphanedDaemonsCount = daemonsKilled;
    }
  }

  if (options.removeOutput) {
    cleanupOutputFile(state);
  }

  return {
    cleaned: {
      session: state.sessionCleaned,
      chrome: state.chromeCleaned,
      daemons: state.daemonsCleaned,
      output: state.outputCleaned,
    },
    orphanedDaemonsCount: state.orphanedDaemonsCount,
    warnings: state.warnings,
  };
}
