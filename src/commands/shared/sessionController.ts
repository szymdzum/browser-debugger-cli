import {
  cleanupChromeAttemptingMessage,
  cleanupChromePidNotFoundMessage,
  cleanupChromeKillingMessage,
  cleanupChromeSuccessMessage,
  cleanupChromeFailedMessage,
  cleanupChromeProcessFailedMessage,
} from '@/ui/messages/chrome.js';
import { getErrorMessage } from '@/utils/errors.js';

/**
 * Aggressively cleanup stale Chrome processes launched by bdg.
 *
 * This function kills Chrome instances that were launched by bdg by:
 * 1. Reading the Chrome PID from persistent cache (~/.bdg/chrome.pid)
 * 2. Killing that specific Chrome process using cross-platform kill logic
 *
 * The cache survives session cleanup, so this works even after a normal session end.
 *
 * Cross-platform killing:
 * - Windows: Uses `taskkill /pid <pid> /T /F` to kill process tree
 * - Unix/macOS: Uses `process.kill(-pid, 'SIGKILL')` to kill process group
 *
 * Note: We can't use chromeLauncher.killAll() because it only tracks instances
 * created via chromeLauncher.launch(), but we use new chromeLauncher.Launcher()
 * which doesn't register in that tracking set.
 *
 * @returns Number of errors encountered during cleanup
 */
export async function cleanupStaleChrome(): Promise<number> {
  console.error(cleanupChromeAttemptingMessage());

  try {
    // Import session utilities (dynamic import for ES modules)
    const { readChromePid, clearChromePid } = await import('@/session/chrome.js');
    const { killChromeProcess } = await import('@/session/process.js');

    // Read Chrome PID from persistent cache
    const chromePid = readChromePid();

    if (!chromePid) {
      console.error(cleanupChromePidNotFoundMessage());
      return 0;
    }

    // Kill Chrome process (cross-platform)
    console.error(cleanupChromeKillingMessage(chromePid));

    try {
      // Use SIGKILL for aggressive cleanup (force kill)
      killChromeProcess(chromePid, 'SIGKILL');

      console.error(cleanupChromeSuccessMessage());

      // Clear the cache after successful kill
      clearChromePid();

      return 0;
    } catch (killError) {
      console.error(cleanupChromeFailedMessage(getErrorMessage(killError)));
      return 1;
    }
  } catch (error) {
    console.error(cleanupChromeProcessFailedMessage(getErrorMessage(error)));
    return 1;
  }
}
