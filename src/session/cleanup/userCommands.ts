/**
 * Cleanup behind the user-facing `bdg cleanup` command.
 */

import * as fs from 'fs';

import {
  killOrphanedChrome,
  killSessionChromes,
  readLiveDaemonPid,
  removeStaleDaemonFiles,
} from '@/session/cleanup/staleSession.js';
import { isDaemonAlive } from '@/session/daemonSocket.js';
import { clearLastSessionEnd } from '@/session/lastSession.js';
import { SESSION_STATE_FILES, getSessionFilePath } from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('cleanup');

const DAEMON_EXIT_WAIT_MS = 2000;

/**
 * Options for session cleanup.
 */
export interface SessionCleanupOptions {
  /** Kill a running (possibly hung) daemon before cleaning */
  force?: boolean | undefined;
  /** Also remove the legacy session.json output file */
  removeOutput?: boolean | undefined;
}

/**
 * Result of session cleanup.
 */
export interface SessionCleanupResult {
  cleaned: {
    session: boolean;
    chrome: boolean;
    daemons: boolean;
    output: boolean;
  };
  warnings: string[];
}

/**
 * Clean up session state.
 *
 * With `force`, a live daemon is killed first (after verifying its command
 * line). Then stale daemon files are removed and an orphaned bdg Chrome, if
 * any, is killed, and, once no daemon of the session runs, every other
 * Chrome launched for this session directory (one chrome.pid lost track of).
 * The record of a session that ended without `bdg stop` is removed too, and
 * counts as cleaned session files.
 *
 * @param options - Cleanup options
 * @returns What was cleaned, plus warnings
 */
export async function performSessionCleanup(
  options: SessionCleanupOptions
): Promise<SessionCleanupResult> {
  const warnings: string[] = [];
  const filesBefore = countSessionFiles();
  const daemonKilled = options.force ? await killLiveDaemon(warnings) : false;
  const session = await removeStaleDaemonFiles();
  const orphan = killOrphanedChrome();
  const unrecorded = readLiveDaemonPid() === null ? killSessionChromes() : [];
  const chrome = orphan || unrecorded.length > 0;
  const output = options.removeOutput ? removeOutputFile(warnings) : false;
  const filesRemoved = countSessionFiles() < filesBefore;
  const endedRecordRemoved = clearLastSessionEnd();

  return {
    cleaned: {
      session: session || daemonKilled || filesRemoved || endedRecordRemoved,
      chrome,
      daemons: daemonKilled,
      output,
    },
    warnings,
  };
}

/**
 * How many session files exist.
 *
 * @returns Number of existing session files
 */
function countSessionFiles(): number {
  return SESSION_STATE_FILES.filter((type) => fs.existsSync(getSessionFilePath(type))).length;
}

/**
 * SIGKILL a live bdg daemon and wait briefly for its socket to go away.
 *
 * @param warnings - Collector for non-fatal problems
 * @returns True if a daemon was killed
 */
async function killLiveDaemon(warnings: string[]): Promise<boolean> {
  const pid = readLiveDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, 'SIGKILL');
    log.info(`Killed daemon (PID ${pid})`);
  } catch (error) {
    warnings.push(`Could not kill daemon ${pid}: ${getErrorMessage(error)}`);
    return false;
  }
  const deadline = Date.now() + DAEMON_EXIT_WAIT_MS;
  while (Date.now() < deadline && (await isDaemonAlive())) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * Remove the legacy session.json output file.
 *
 * @param warnings - Collector for non-fatal problems
 * @returns True if the file was removed
 */
function removeOutputFile(warnings: string[]): boolean {
  const outputPath = getSessionFilePath('OUTPUT');
  if (!fs.existsSync(outputPath)) return false;
  try {
    fs.unlinkSync(outputPath);
    return true;
  } catch (error) {
    warnings.push(`Could not remove session.json: ${getErrorMessage(error)}`);
    return false;
  }
}
