/**
 * Low-level cleanup primitives shared across lifecycle phases.
 *
 * These helpers SIGKILL processes and clear chrome-pid caches. They are
 * intentionally kept at the bottom of the dependency graph so every
 * lifecycle-phase module (`preStart`, `runtime`, `postSession`) can import
 * them without reaching across phases.
 */

import { clearChromePid, readChromePid } from '@/session/chrome.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive, killChromeProcess } from '@/utils/process.js';

const log = createLogger('cleanup');

/**
 * SIGKILL an orphaned worker process. Never throws — logs failures so a
 * stuck PID cannot block daemon startup.
 */
export function killOrphanedWorker(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
    log.info(`Force killed orphaned worker process ${pid}`);
  } catch (error) {
    log.info(`Failed to kill orphaned worker process ${pid}: ${getErrorMessage(error)}`);
  }
}

/**
 * SIGKILL the Chrome process whose PID is recorded in `chrome.pid`, clearing
 * the cache if the kill succeeded (or the process is already dead).
 */
export function killCachedChromeProcess(reason: string): void {
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
