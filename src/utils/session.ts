import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BdgOutput } from '../types.js';

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
  chromePid?: number;
  startTime: number;
  port: number;
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
  } catch (error) {
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
  } catch (error) {
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
    } catch (error) {
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
  } catch (error) {
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
  } catch (error: any) {
    if (error.code === 'EEXIST') {
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
  } catch (error) {
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
  } catch (error) {
    return null;
  }
}

/**
 * Cleanup all session files.
 *
 * Removes PID, lock, metadata, and output files.
 */
export function cleanupSession(): void {
  cleanupPidFile();
  releaseSessionLock();

  const metaPath = getMetadataFilePath();
  if (fs.existsSync(metaPath)) {
    try {
      fs.unlinkSync(metaPath);
    } catch (error) {
      // Ignore errors
    }
  }
}
