/**
 * Chrome PID cache management.
 *
 * Persistent cache for Chrome PID that survives session cleanup.
 * WHY: Enables aggressive Chrome cleanup even after session ends (for `bdg cleanup --chrome`).
 */

import * as fs from 'fs';

import { AtomicFileWriter } from '@/utils/atomicFile.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { isProcessAlive } from './process.js';

/**
 * Write Chrome PID to persistent cache.
 *
 * This cache survives session cleanup so aggressive cleanup can find Chrome later.
 * WHY: Users may want to kill Chrome after session ends, especially for testing.
 *
 * @param chromePid - Chrome process ID to cache
 *
 * @example
 * ```typescript
 * const chrome = await launchChrome();
 * writeChromePid(chrome.pid);
 * ```
 */
export function writeChromePid(chromePid: number): void {
  ensureSessionDir();
  const cachePath = getSessionFilePath('CHROME_PID');
  AtomicFileWriter.writeSync(cachePath, chromePid.toString());
}

/**
 * Read Chrome PID from persistent cache.
 *
 * Only returns the PID if the process is still alive.
 * Automatically cleans up stale cache entries.
 *
 * @returns Chrome PID if cached and process is alive, null otherwise
 *
 * @example
 * ```typescript
 * const chromePid = readChromePid();
 * if (chromePid) {
 *   console.log(`Chrome is running with PID ${chromePid}`);
 *   killChromeProcess(chromePid, 'SIGKILL');
 * }
 * ```
 */
export function readChromePid(): number | null {
  const cachePath = getSessionFilePath('CHROME_PID');

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const pidStr = fs.readFileSync(cachePath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return null;
    }

    // Only return the PID if the process is still alive
    // This prevents trying to kill stale PIDs
    if (!isProcessAlive(pid)) {
      // Clean up stale cache
      try {
        fs.unlinkSync(cachePath);
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

/**
 * Remove Chrome PID from persistent cache.
 *
 * Safe to call multiple times (idempotent).
 */
export function clearChromePid(): void {
  const cachePath = getSessionFilePath('CHROME_PID');

  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}
