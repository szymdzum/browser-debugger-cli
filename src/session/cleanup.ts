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

import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { safeRemoveFile } from '@/utils/file.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

import { readChromePid, clearChromePid } from './chrome.js';
import { acquireSessionLock, releaseSessionLock } from './lock.js';
import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { readPid, cleanupPidFile, readPidFromFile } from './pid.js';

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
 * Get the BDG_SESSION_DIR for a given process by reading /proc/PID/environ.
 *
 * @param pid - Process ID to check
 * @returns Session directory or null if not found/accessible
 */
function getProcessSessionDir(pid: number): string | null {
  try {
    const environPath = `/proc/${pid}/environ`;
    const environ = fs.readFileSync(environPath, 'utf-8');
    // Environment variables are null-separated
    const vars = environ.split('\0');
    for (const v of vars) {
      if (v.startsWith('BDG_SESSION_DIR=')) {
        return v.substring('BDG_SESSION_DIR='.length);
      }
    }
    return null;
  } catch {
    // Process may have exited or we don't have permissions
    return null;
  }
}

/**
 * Find all orphaned daemon processes and return their PIDs.
 *
 * Orphaned daemons are node processes running dist/daemon.js that:
 * 1. Are not the currently tracked daemon in the PID file
 * 2. Belong to the same BDG_SESSION_DIR as the current session
 *
 * This ensures that daemons from other sessions (with different BDG_SESSION_DIR)
 * are NOT killed, providing proper session isolation.
 *
 * @returns Array of orphaned daemon PIDs
 */
async function findOrphanedDaemons(): Promise<number[]> {
  const orphanedPids: number[] = [];

  try {
    const daemonPidPath = getSessionFilePath('DAEMON_PID');
    const currentDaemonPid = readPidFromFile(daemonPidPath);
    const currentSessionDir = process.env['BDG_SESSION_DIR'] ?? null;

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

      if (!isProcessAlive(pid)) {
        continue;
      }

      // Cross-session safety: Only consider daemons from THIS session directory
      // Daemons from other sessions should not be touched
      if (process.platform !== 'win32') {
        const processSessionDir = getProcessSessionDir(pid);
        // If we can determine the daemon's session dir and it differs from ours, skip it
        if (processSessionDir !== null && processSessionDir !== currentSessionDir) {
          log.debug(`Skipping daemon ${pid} from different session: ${processSessionDir}`);
          continue;
        }
        // If process session dir is null but current session dir is set,
        // this daemon may be from a session without BDG_SESSION_DIR - still skip for safety
        if (processSessionDir === null && currentSessionDir !== null) {
          log.debug(`Skipping daemon ${pid} with unknown session dir (safety)`);
          continue;
        }
      }

      orphanedPids.push(pid);
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

  log.debug(`Found ${orphanedPids.length} orphaned daemon process(es): ${orphanedPids.join(', ')}`);

  let killedCount = 0;

  for (const pid of orphanedPids) {
    try {
      process.kill(pid, 'SIGKILL');
      log.debug(`Killed orphaned daemon process ${pid}`);
      killedCount++;
    } catch (error) {
      logDebugError(log, `kill orphaned daemon ${pid}`, error);
    }
  }

  return killedCount;
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
