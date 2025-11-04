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
  console.error('\nAttempting to kill stale Chrome processes...');

  try {
    // Import session utilities (dynamic import for ES modules)
    const { readChromePid, clearChromePid } = await import('@/session/chrome.js');
    const { killChromeProcess } = await import('@/session/process.js');

    // Read Chrome PID from persistent cache
    const chromePid = readChromePid();

    if (!chromePid) {
      console.error('Warning: No Chrome PID found in cache');
      console.error('   Either Chrome was already running, or no Chrome was launched by bdg\n');
      return 0;
    }

    // Kill Chrome process (cross-platform)
    console.error(`Killing Chrome process (PID: ${chromePid})...`);

    try {
      // Use SIGKILL for aggressive cleanup (force kill)
      killChromeProcess(chromePid, 'SIGKILL');

      console.error('Chrome process killed successfully');

      // Clear the cache after successful kill
      clearChromePid();

      return 0;
    } catch (killError) {
      console.error(`Error: Failed to kill Chrome process: ${getErrorMessage(killError)}`);
      console.error('   Try manually killing Chrome processes if issues persist\n');
      return 1;
    }
  } catch (error) {
    console.error(`Error: Failed to cleanup Chrome processes: ${getErrorMessage(error)}\n`);
    return 1;
  }
}
