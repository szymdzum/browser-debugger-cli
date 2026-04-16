/**
 * Runtime cleanup: runs WHILE the daemon is alive.
 *
 * Invariants at this phase:
 * - The daemon process is still running (this code executes inside it).
 * - Only session-scoped files (PID, metadata, query cache) may be removed.
 * - Daemon-scoped files (daemon.pid, daemon.sock, daemon.lock) MUST remain.
 *
 * Used to recover when the worker's CDP connection has died but the worker
 * process may still be alive — the daemon force-kills the worker (and
 * bdg-launched Chrome if known) and starts a fresh session in-place.
 */

import { QueryCacheManager } from '@/session/QueryCacheManager.js';
import { getSessionFilePath } from '@/session/paths.js';
import { cleanupPidFile } from '@/session/pid.js';
import { createLogger, logDebugError } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { safeRemoveFile } from '@/utils/file.js';
import { killChromeProcess } from '@/utils/process.js';

const log = createLogger('cleanup');

/**
 * Force-recover a stale session while the daemon is still running.
 *
 * Terminates the worker (and bdg-launched Chrome, if any) and clears only
 * the session-scoped files, leaving daemon files intact so the daemon can
 * immediately start a fresh session.
 *
 * @param workerPid - Worker process ID to terminate
 * @param chromePid - Optional Chrome PID (only set when bdg launched Chrome)
 */
export async function recoverStaleSessionAtRuntime(
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
