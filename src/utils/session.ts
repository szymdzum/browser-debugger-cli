import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { BdgOutput } from '@/types';

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
  return path.join(getSessionDir(), 'session.pid');
}

/**
 * Get the path to the output JSON file
 */
export function getOutputFilePath(): string {
  return path.join(getSessionDir(), 'session.json');
}

/**
 * Get the path to the session lock file
 */
export function getLockFilePath(): string {
  return path.join(getSessionDir(), 'session.lock');
}

/**
 * Get the path to the session metadata file
 */
export function getMetadataFilePath(): string {
  return path.join(getSessionDir(), 'session.meta.json');
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
 */
export function writeSessionOutput(output: BdgOutput): void {
  ensureSessionDir();
  const outputPath = getOutputFilePath();
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
}

/**
 * Read session output from the JSON file
 *
 * @returns The BdgOutput data if file exists and is valid, null otherwise
 */
export function readSessionOutput(): BdgOutput | null {
  const outputPath = getOutputFilePath();

  if (!fs.existsSync(outputPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(outputPath, 'utf-8');
    return JSON.parse(content) as BdgOutput;
  } catch {
    return null;
  }
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
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
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
 * Get the path to the partial output file (lightweight preview, metadata only)
 */
export function getPartialFilePath(): string {
  return path.join(getSessionDir(), 'session.preview.json');
}

/**
 * Get the path to the full output file (complete data with bodies)
 */
export function getFullFilePath(): string {
  return path.join(getSessionDir(), 'session.full.json');
}

/**
 * Write partial session output for live preview (lightweight, metadata only).
 *
 * Uses atomic write (tmp file + rename) to prevent corruption.
 * Excludes request/response bodies and limits to last 1000 items.
 *
 * @param output - The partial BdgOutput data to write
 */
export function writePartialOutput(output: BdgOutput): void {
  ensureSessionDir();
  const partialPath = getPartialFilePath();
  const tmpPath = partialPath + '.tmp';

  // Write to temp file first, then rename for atomicity
  fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2), 'utf-8');
  fs.renameSync(tmpPath, partialPath);
}

/**
 * Write full session output for details view (complete data with bodies).
 *
 * Uses atomic write (tmp file + rename) to prevent corruption.
 * Includes all data with request/response bodies.
 *
 * @param output - The full BdgOutput data to write
 */
export function writeFullOutput(output: BdgOutput): void {
  ensureSessionDir();
  const fullPath = getFullFilePath();
  const tmpPath = fullPath + '.tmp';

  // Write to temp file first, then rename for atomicity
  fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2), 'utf-8');
  fs.renameSync(tmpPath, fullPath);
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
