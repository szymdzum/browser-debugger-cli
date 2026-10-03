/**
 * Cleanup of state left behind by a daemon that died without tearing down.
 *
 * A healthy daemon removes its own files on exit. These helpers only matter
 * after a crash or SIGKILL. Processes are signalled only after their command
 * line confirms they are what the PID file claims, so a reused PID can never
 * get an unrelated process killed.
 */

import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { clearChromePid, readChromePid } from '@/session/chrome.js';
import { probeDaemonSocket } from '@/session/daemonSocket.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readDaemonPid } from '@/session/pid.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { safeRemoveFile } from '@/utils/file.js';
import { getProcessCommand, isProcessAlive, killChromeProcess } from '@/utils/process.js';

const log = createLogger('cleanup');

/** Marker present in the command line of every Chrome bdg launches. */
const CHROME_COMMAND_MARKER = '--remote-debugging-port=';

/** Marker present in the command line of the bdg daemon. */
const DAEMON_COMMAND_MARKER = 'daemon.js';

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
 * Kill the Chrome recorded in chrome.pid, if it is still a bdg-launched Chrome.
 *
 * @returns True if a Chrome process was killed
 */
export function killOrphanedChrome(): boolean {
  const chromePid = readChromePid();
  if (!chromePid) return false;
  if (!getProcessCommand(chromePid)?.includes(CHROME_COMMAND_MARKER)) {
    log.debug(`PID ${chromePid} is no longer a bdg Chrome; dropping chrome.pid`);
    clearChromePid();
    return false;
  }
  log.info(`Killing orphaned Chrome (PID ${chromePid})`);
  try {
    killChromeProcess(chromePid, 'SIGKILL');
  } catch (error) {
    logDebugError(log, `kill Chrome ${chromePid}`, error);
  }
  clearChromePid();
  return true;
}

/**
 * Read the PID of a live bdg daemon from daemon.pid.
 *
 * @returns Daemon PID if the process is alive and is a bdg daemon, else null
 */
export function readLiveDaemonPid(): number | null {
  const pid = readDaemonPid();
  if (!pid || !isProcessAlive(pid)) return null;
  return getProcessCommand(pid)?.includes(DAEMON_COMMAND_MARKER) ? pid : null;
}
