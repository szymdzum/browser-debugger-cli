/**
 * PID file reading.
 *
 * PID files are informational only: liveness is decided by the daemon socket
 * (see daemonSocket.ts). A PID read here must be verified (e.g. by command
 * line) before it is used to signal a process.
 */

import * as fs from 'fs';

import { getSessionFilePath } from './paths.js';

/**
 * Read a positive integer PID from a file.
 *
 * @param filePath - Path to the PID file
 * @returns PID, or null if the file is missing or does not hold a positive integer
 *
 * @example
 * ```typescript
 * const daemonPid = readPidFromFile('/path/to/daemon.pid');
 * ```
 */
export function readPidFromFile(filePath: string): number | null {
  try {
    const pidStr = fs.readFileSync(filePath, 'utf-8').trim();
    if (!/^\d+$/.test(pidStr)) return null;
    const pid = Number(pidStr);
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Read the daemon PID file.
 *
 * @returns Daemon PID, or null if unavailable
 */
export function readDaemonPid(): number | null {
  return readPidFromFile(getSessionFilePath('DAEMON_PID'));
}
