/**
 * Chrome PID cache management.
 *
 * Persistent cache for Chrome PID that survives session cleanup.
 * WHY: Enables aggressive Chrome cleanup even after session ends (for `bdg cleanup --chrome`).
 */

import * as fs from 'fs';

import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';
import { isProcessAlive } from './process.js';

const log = createLogger('chrome');

/**
 * Parse Chrome PID from cache file content.
 *
 * @param pidStr - PID string from cache file
 * @returns Parsed PID or null if invalid
 */
function parseChromePid(pidStr: string): number | null {
  const pid = parseInt(pidStr.trim(), 10);
  return Number.isNaN(pid) ? null : pid;
}

/**
 * Remove Chrome PID cache file safely.
 *
 * @param cachePath - Path to cache file
 * @param reason - Reason for removal (for logging)
 */
function removeChromePidCache(cachePath: string, reason: string): void {
  try {
    fs.rmSync(cachePath, { force: true });
  } catch (error) {
    log.debug(`Failed to remove ${reason} Chrome PID cache: ${getErrorMessage(error)}`);
  }
}

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
    const pidStr = fs.readFileSync(cachePath, 'utf-8');
    const pid = parseChromePid(pidStr);

    if (pid === null) {
      removeChromePidCache(cachePath, 'corrupt');
      return null;
    }

    if (!isProcessAlive(pid)) {
      removeChromePidCache(cachePath, 'stale');
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
    fs.rmSync(cachePath, { force: true });
  } catch (error) {
    log.debug(`Failed to clear Chrome PID cache: ${getErrorMessage(error)}`);
  }
}
