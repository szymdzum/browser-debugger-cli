/**
 * Cleanup of state left behind by a daemon that died without tearing down.
 *
 * A healthy daemon removes its own files on exit. These helpers only matter
 * after a crash or SIGKILL. Processes are signalled only after their command
 * line confirms they are what the PID file claims, so a reused PID can never
 * get an unrelated process killed.
 */

import { chromeSessionMarkerFlag } from '@/connection/launcher/flagsBuilder.js';
import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { clearChromePid, readChromePid } from '@/session/chrome.js';
import { probeDaemonSocket } from '@/session/daemonSocket.js';
import { getSessionDir, getSessionFilePath, sessionFilePathIn } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { safeRemoveFile } from '@/utils/file.js';
import { DAEMON_SCRIPT_PATH } from '@/utils/packageRoot.js';
import { getProcessCommand, isProcessAlive, killChromeProcess } from '@/utils/process.js';

const log = createLogger('cleanup');

/**
 * Check whether a process command line contains an exact argument.
 *
 * @param command - Full command line
 * @param arg - Argument to look for
 * @returns True if `arg` appears as a whole space-delimited argument
 */
function hasArgument(command: string | null, arg: string): boolean {
  if (!command) return false;
  return command.includes(`${arg} `) || command.endsWith(arg);
}

/**
 * Remove per-session files (metadata, query cache).
 *
 * Called by the daemon when its session ends, and by `bdg cleanup`.
 */
export function removeSessionFiles(): void {
  safeRemoveFile(getSessionFilePath('METADATA'), 'metadata file', log);
  void QueryCacheManager.getInstance()
    .clear()
    .catch((error) => logDebugError(log, 'clear query cache', error));
}

/**
 * Remove daemon and session files if no daemon is listening.
 *
 * @returns True if a stale daemon socket was found and cleaned up
 */
export async function removeStaleDaemonFiles(): Promise<boolean> {
  const probe = await probeDaemonSocket();
  if (probe === 'alive') return false;
  safeRemoveFile(getSessionFilePath('DAEMON_SOCKET'), 'daemon socket', log);
  safeRemoveFile(getSessionFilePath('DAEMON_PID'), 'daemon PID file', log);
  removeSessionFiles();
  return probe === 'stale';
}

/**
 * The Chrome recorded in chrome.pid, if it is still running and still the
 * Chrome bdg launched for this session directory (verified by its marker
 * flag). A PID that now belongs to another process is dropped.
 *
 * @returns Chrome PID, or null
 */
export function findOrphanedChrome(): number | null {
  const chromePid = readChromePid();
  if (!chromePid) return null;
  if (isSessionChrome(chromePid, getSessionDir())) return chromePid;
  log.debug(`PID ${chromePid} is no longer a bdg Chrome; dropping chrome.pid`);
  clearChromePid();
  return null;
}

/**
 * Whether a process is the Chrome bdg launched for a session directory: its
 * command line carries the directory's marker flag.
 *
 * @param pid - Process ID
 * @param sessionDir - Session directory
 * @returns True for that session's Chrome
 */
export function isSessionChrome(pid: number, sessionDir: string): boolean {
  return hasArgument(getProcessCommand(pid), chromeSessionMarkerFlag(sessionDir));
}

/**
 * Kill the Chrome recorded in chrome.pid, if it is still the Chrome bdg launched
 * for this session directory (verified by its marker flag).
 *
 * @returns True if a Chrome process was killed
 */
export function killOrphanedChrome(): boolean {
  const chromePid = findOrphanedChrome();
  if (!chromePid) return false;
  log.info(`Killing orphaned Chrome (PID ${chromePid})`);
  try {
    killChromeProcess(chromePid, 'SIGKILL');
  } catch (error) {
    logDebugError(log, `kill Chrome ${chromePid}`, error);
  }
  clearChromePid();
  return true;
}

/** How long to wait for a killed orphaned Chrome to exit (and free its port) */
const ORPHAN_EXIT_WAIT_MS = 5000;

/**
 * Kill an orphaned Chrome (see {@link killOrphanedChrome}) and wait until it
 * has exited, so its debugging port is free for the next launch.
 *
 * @returns True if a Chrome process was killed
 */
export async function reapOrphanedChrome(): Promise<boolean> {
  const chromePid = findOrphanedChrome();
  if (!killOrphanedChrome() || chromePid === null) return false;
  const deadline = Date.now() + ORPHAN_EXIT_WAIT_MS;
  while (isProcessAlive(chromePid) && Date.now() < deadline) await delay(50);
  return true;
}

/**
 * Read the PID of a live bdg daemon from daemon.pid.
 *
 * @param dir - Session directory (defaults to the selected session's)
 * @returns Daemon PID if the process is alive and is a bdg daemon, else null
 */
export function readLiveDaemonPid(dir: string = getSessionDir()): number | null {
  const pid = readPidFromFile(sessionFilePathIn(dir, 'DAEMON_PID'));
  if (!pid || !isProcessAlive(pid)) return null;
  return hasArgument(getProcessCommand(pid), DAEMON_SCRIPT_PATH) ? pid : null;
}
