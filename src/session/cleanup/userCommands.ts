/**
 * User-invoked cleanup: orchestrator for `bdg stop` and `bdg cleanup`.
 *
 * Composes the lower-phase cleanup modules (`preStart`, `postSession`,
 * `primitives`) plus orphaned-daemon scanning into a single entry point
 * that honors the user's `--force`, `--aggressive`, `--kill-chrome`, and
 * `--remove-output` flags.
 */

import * as fs from 'fs';

import { cleanupOrphanedDaemons } from '@/session/cleanup/orphanedDaemons.js';
import { cleanupAfterSessionEnd } from '@/session/cleanup/postSession.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPid } from '@/session/pid.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

const log = createLogger('cleanup');

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

  cleanupAfterSessionEnd();
  state.sessionCleaned = true;
}

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
 * Handles Chrome processes, daemon PIDs, session files, and orphaned
 * processes based on the flags the user passed.
 */
export async function performSessionCleanup(
  options: SessionCleanupOptions
): Promise<SessionCleanupResult> {
  const { cleanupStaleChrome, clearChromePid } = await import('@/session/chrome.js');
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
