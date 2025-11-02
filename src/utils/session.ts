import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { BdgOutput, CollectorType } from '@/types';

/**
 * Session file paths relative to ~/.bdg/
 * Centralized definition for all session-related files.
 */
const SESSION_FILES = {
  PID: 'session.pid',
  OUTPUT: 'session.json',
  LOCK: 'session.lock',
  METADATA: 'session.meta.json',
  CHROME_PID: 'chrome.pid',
  PREVIEW: 'session.preview.json',
  FULL: 'session.full.json',
} as const;

/**
 * Get the session directory path (~/.bdg)
 */
export function getSessionDir(): string {
  return path.join(os.homedir(), '.bdg');
}

/**
 * Ensure the session directory exists
 */
export function ensureSessionDir(): void {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the path to the PID file
 */
export function getPidFilePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.PID);
}

/**
 * Get the path to the output JSON file
 */
export function getOutputFilePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.OUTPUT);
}

/**
 * Get the path to the session lock file
 */
export function getLockFilePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.LOCK);
}

/**
 * Get the path to the session metadata file
 */
export function getMetadataFilePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.METADATA);
}

/**
 * Get the path to the persistent Chrome PID cache file.
 * This file survives session cleanup so aggressive cleanup can still find Chrome.
 */
export function getChromePidCachePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.CHROME_PID);
}

/**
 * Session metadata stored alongside PID
 */
export interface SessionMetadata {
  bdgPid: number;
  chromePid?: number | undefined;
  startTime: number;
  port: number;
  targetId?: string | undefined;
  webSocketDebuggerUrl?: string | undefined;
  activeCollectors?: CollectorType[] | undefined;
}

/**
 * Write the current process PID to the session file atomically
 *
 * @param pid - Process ID to write
 */
export function writePid(pid: number): void {
  ensureSessionDir();
  const pidPath = getPidFilePath();
  const tmpPath = pidPath + '.tmp';

  // Write to temp file first, then rename for atomicity
  fs.writeFileSync(tmpPath, pid.toString(), 'utf-8');
  fs.renameSync(tmpPath, pidPath);
}

/**
 * Read the PID from the session file
 *
 * @returns The PID if file exists and is valid, null otherwise
 */
export function readPid(): number | null {
  const pidPath = getPidFilePath();

  if (!fs.existsSync(pidPath)) {
    return null;
  }

  try {
    const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

/**
 * Check if a process with the given PID is alive
 *
 * @param pid - Process ID to check
 * @returns True if process is running, false otherwise
 */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH error means process doesn't exist
    return false;
  }
}

/**
 * Remove the PID file
 */
export function cleanupPidFile(): void {
  const pidPath = getPidFilePath();

  if (fs.existsSync(pidPath)) {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Write session output to the JSON file
 *
 * @param output - The BdgOutput data to write
 * @param compact - If true, use compact JSON format (no indentation)
 */
export function writeSessionOutput(output: BdgOutput, compact: boolean = false): void {
  ensureSessionDir();
  const outputPath = getOutputFilePath();
  const tmpPath = outputPath + '.tmp';
  const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  fs.writeFileSync(tmpPath, jsonString, 'utf-8');
  fs.renameSync(tmpPath, outputPath);
}

/**
 * Acquire session lock atomically.
 *
 * Uses exclusive file creation (wx flag) to ensure only one session can run.
 *
 * @returns True if lock was acquired, false if another session is running
 */
export function acquireSessionLock(): boolean {
  ensureSessionDir();
  const lockPath = getLockFilePath();

  try {
    // 'wx' flag creates file exclusively - fails if exists
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      // Lock file exists - check if process is still alive
      try {
        const lockPidStr = fs.readFileSync(lockPath, 'utf-8').trim();
        const lockPid = parseInt(lockPidStr, 10);

        if (!isNaN(lockPid) && isProcessAlive(lockPid)) {
          // Lock is held by active process
          return false;
        } else {
          // Stale lock file - remove it and try again
          fs.unlinkSync(lockPath);
          return acquireSessionLock();
        }
      } catch {
        // Can't read lock file - assume it's stale
        try {
          fs.unlinkSync(lockPath);
          return acquireSessionLock();
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}

/**
 * Release session lock.
 *
 * Removes the lock file to allow other sessions to start.
 */
export function releaseSessionLock(): void {
  const lockPath = getLockFilePath();

  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Write session metadata.
 *
 * @param metadata - Session metadata to write
 */
export function writeSessionMetadata(metadata: SessionMetadata): void {
  ensureSessionDir();
  const metaPath = getMetadataFilePath();
  const tmpPath = metaPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(metadata, null, 2), 'utf-8');
  fs.renameSync(tmpPath, metaPath);
}

/**
 * Read session metadata.
 *
 * @returns Session metadata if file exists and is valid, null otherwise
 */
export function readSessionMetadata(): SessionMetadata | null {
  const metaPath = getMetadataFilePath();

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}

/**
 * Write Chrome PID to persistent cache.
 * This survives session cleanup so aggressive cleanup can find Chrome later.
 *
 * @param chromePid - Chrome process ID to cache
 */
export function writeChromePid(chromePid: number): void {
  ensureSessionDir();
  const cachePath = getChromePidCachePath();
  const tmpPath = cachePath + '.tmp';

  // Write to temp file first, then rename for atomicity
  fs.writeFileSync(tmpPath, chromePid.toString(), 'utf-8');
  fs.renameSync(tmpPath, cachePath);
}

/**
 * Read Chrome PID from persistent cache.
 *
 * @returns Chrome PID if cached and process is alive, null otherwise
 */
export function readChromePid(): number | null {
  const cachePath = getChromePidCachePath();

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
 */
export function clearChromePid(): void {
  const cachePath = getChromePidCachePath();

  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Kill a Chrome process using cross-platform approach.
 *
 * Windows: Uses `taskkill /pid <pid> /T /F` to kill process tree
 * Unix/macOS: Uses `process.kill(-pid, signal)` to kill process group
 *
 * @param pid - Chrome process ID to kill
 * @param signal - Signal to send (Unix only, default 'SIGTERM'). Ignored on Windows.
 * @throws Error if kill operation fails
 */
export function killChromeProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Windows: Use taskkill to kill process tree
    // /T = kill process tree, /F = force kill
    const result = spawnSync(`taskkill /pid ${pid} /T /F`, {
      shell: true,
      encoding: 'utf-8',
    });

    // Check for spawn errors (command not found, etc.)
    if (result.error) {
      throw result.error;
    }

    // Check exit status - taskkill returns non-zero on failure
    // Common exit codes:
    // - 0: Success
    // - 128: Process not found
    // - 1: Access denied or other error
    if (result.status !== 0) {
      const errorMsg = (result.stderr ?? result.stdout).trim() || 'Unknown error';
      throw new Error(`taskkill failed (exit code ${result.status}): ${errorMsg}`);
    }

    // Log stderr for debugging (taskkill sometimes writes to stderr even on success)
    if (result.stderr?.trim()) {
      console.error(`taskkill stderr: ${result.stderr.trim()}`);
    }
  } else {
    // Unix/macOS: Kill process group (negative PID)
    // This kills Chrome and all child processes
    process.kill(-pid, signal);
  }
}

/**
 * Get the path to the partial output file (lightweight preview, metadata only)
 */
export function getPartialFilePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.PREVIEW);
}

/**
 * Get the path to the full output file (complete data with bodies)
 */
export function getFullFilePath(): string {
  return path.join(getSessionDir(), SESSION_FILES.FULL);
}

/**
 * Write partial session output for live preview (async version).
 *
 * Uses atomic write (tmp file + rename) to prevent corruption.
 * Non-blocking version for periodic writes during collection.
 *
 * @param output - The partial BdgOutput data to write
 * @param compact - If true, use compact JSON format (no indentation)
 * @returns Promise that resolves when write completes
 */
export async function writePartialOutputAsync(
  output: BdgOutput,
  compact: boolean = false
): Promise<void> {
  const startTime = Date.now();
  ensureSessionDir();
  const partialPath = getPartialFilePath();
  const tmpPath = partialPath + '.tmp';

  // JSON.stringify is synchronous and blocks event loop - measure it separately
  const stringifyStart = Date.now();
  const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  const stringifyDuration = Date.now() - stringifyStart;

  // Calculate size savings when using compact mode
  const sizeKB = (jsonString.length / 1024).toFixed(1);
  if (compact) {
    // Estimate pretty-printed size (rough heuristic: 30% larger due to indentation)
    const estimatedPrettyKB = ((jsonString.length * 1.3) / 1024).toFixed(1);
    const savedKB = (parseFloat(estimatedPrettyKB) - parseFloat(sizeKB)).toFixed(1);
    console.error(
      `[PERF] Preview JSON.stringify: ${stringifyDuration}ms (${sizeKB}KB compact, saved ~${savedKB}KB)`
    );
  } else {
    console.error(`[PERF] Preview JSON.stringify: ${stringifyDuration}ms (${sizeKB}KB)`);
  }

  // Write to temp file first, then rename for atomicity
  const ioStart = Date.now();
  await fs.promises.writeFile(tmpPath, jsonString, 'utf-8');
  await fs.promises.rename(tmpPath, partialPath);
  const ioDuration = Date.now() - ioStart;

  const totalDuration = Date.now() - startTime;
  console.error(
    `[PERF] Preview write: ${totalDuration}ms (stringify: ${stringifyDuration}ms, I/O: ${ioDuration}ms)`
  );
}

/**
 * Write full session output for details view (async version).
 *
 * Uses atomic write (tmp file + rename) to prevent corruption.
 * Non-blocking version for periodic writes during collection.
 *
 * @param output - The full BdgOutput data to write
 * @param compact - If true, use compact JSON format (no indentation)
 * @returns Promise that resolves when write completes
 */
export async function writeFullOutputAsync(
  output: BdgOutput,
  compact: boolean = false
): Promise<void> {
  const startTime = Date.now();
  ensureSessionDir();
  const fullPath = getFullFilePath();
  const tmpPath = fullPath + '.tmp';

  // JSON.stringify is synchronous and blocks event loop - measure it separately
  const stringifyStart = Date.now();
  const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  const stringifyDuration = Date.now() - stringifyStart;

  // Calculate size savings when using compact mode
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(1);
  if (compact) {
    // Estimate pretty-printed size (rough heuristic: 30% larger due to indentation)
    const estimatedPrettyMB = ((jsonString.length * 1.3) / 1024 / 1024).toFixed(1);
    const savedMB = (parseFloat(estimatedPrettyMB) - parseFloat(sizeMB)).toFixed(1);
    console.error(
      `[PERF] Full JSON.stringify: ${stringifyDuration}ms (${sizeMB}MB compact, saved ~${savedMB}MB)`
    );
  } else {
    console.error(`[PERF] Full JSON.stringify: ${stringifyDuration}ms (${sizeMB}MB)`);
  }

  // Write to temp file first, then rename for atomicity
  const ioStart = Date.now();
  await fs.promises.writeFile(tmpPath, jsonString, 'utf-8');
  await fs.promises.rename(tmpPath, fullPath);
  const ioDuration = Date.now() - ioStart;

  const totalDuration = Date.now() - startTime;
  console.error(
    `[PERF] Full write: ${totalDuration}ms (stringify: ${stringifyDuration}ms, I/O: ${ioDuration}ms)`
  );
}

/**
 * Read partial session output for live preview (lightweight metadata).
 *
 * @returns The partial BdgOutput data if file exists and is valid, null otherwise
 */
export function readPartialOutput(): BdgOutput | null {
  const partialPath = getPartialFilePath();

  if (!fs.existsSync(partialPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(partialPath, 'utf-8');
    return JSON.parse(content) as BdgOutput;
  } catch {
    return null;
  }
}

/**
 * Read full session output for details view (complete data with bodies).
 *
 * @returns The full BdgOutput data if file exists and is valid, null otherwise
 */
export function readFullOutput(): BdgOutput | null {
  const fullPath = getFullFilePath();

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as BdgOutput;
  } catch {
    return null;
  }
}

/**
 * Cleanup all session files.
 *
 * Removes PID, lock, metadata, preview, full, and output files.
 */
export function cleanupSession(): void {
  cleanupPidFile();
  releaseSessionLock();

  const metaPath = getMetadataFilePath();
  if (fs.existsSync(metaPath)) {
    try {
      fs.unlinkSync(metaPath);
    } catch {
      // Ignore errors
    }
  }

  // Clean up preview file (lightweight)
  const partialPath = getPartialFilePath();
  if (fs.existsSync(partialPath)) {
    try {
      fs.unlinkSync(partialPath);
    } catch {
      // Ignore errors
    }
  }

  // Clean up full file (complete data)
  const fullPath = getFullFilePath();
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // Ignore errors
    }
  }
}
