/**
 * Session path generation and management.
 *
 * Centralized path generation for all session-related files in ~/.bdg/
 * WHY: Single source of truth for file locations prevents path inconsistencies.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  DAEMON_PID: 'daemon.pid',
  DAEMON_SOCKET: 'daemon.sock',
  DOM_QUERY_CACHE: 'last-query.json',
} as const;

/**
 * Session file type for type-safe path generation
 */
export type SessionFileType = keyof typeof SESSION_FILES;

/**
 * Get the session directory path (~/.bdg)
 *
 * Uses os.homedir() dynamically to support test environment variable changes.
 *
 * @returns Full path to session directory
 */
export function getSessionDir(): string {
  return path.join(os.homedir(), '.bdg');
}

/**
 * Session directory path (~/.bdg)
 * Exported constant for backward compatibility.
 *
 * WARNING: This is evaluated once at module load time. Prefer getSessionDir()
 * for dynamic resolution (e.g., in tests that change HOME env var).
 */
export const SESSION_DIR = path.join(os.homedir(), '.bdg');

/**
 * Get the path to a session file by type.
 *
 * @param fileType - The type of session file
 * @returns Full path to the session file
 *
 * @example
 * ```typescript
 * getSessionFilePath('PID')        // → ~/.bdg/session.pid
 * getSessionFilePath('DAEMON_PID') // → ~/.bdg/daemon.pid
 * ```
 */
export function getSessionFilePath(fileType: SessionFileType): string {
  return path.join(getSessionDir(), SESSION_FILES[fileType]);
}

/**
 * Get the path to the worker Unix domain socket.
 *
 * WHY: Single canonical place for worker UDS path; predictable cleanup; avoids collisions.
 *
 * @param workerPid - Worker process ID
 * @returns Full path to worker socket
 */
export function getWorkerSocketPath(workerPid: number): string {
  return path.join(getSessionDir(), `worker.${workerPid}.sock`);
}

/**
 * Get the path to the partial/preview output file.
 *
 * WHY: Lightweight preview (metadata only) for fast monitoring without stopping collection.
 *
 * @returns Full path to preview file
 */
export function getPartialFilePath(): string {
  return getSessionFilePath('PREVIEW');
}

/**
 * Get the path to the full output file.
 *
 * WHY: Complete data with bodies for detailed on-demand inspection.
 *
 * @returns Full path to full data file
 */
export function getFullFilePath(): string {
  return getSessionFilePath('FULL');
}

/**
 * Get the path to the DOM query cache file.
 *
 * WHY: Stores last DOM query results for index-based element references.
 *
 * @returns Full path to DOM query cache file
 */
export function getDomQueryCachePath(): string {
  return getSessionFilePath('DOM_QUERY_CACHE');
}

/**
 * Ensure the session directory exists.
 *
 * Creates ~/.bdg/ if it doesn't exist. Safe to call multiple times (idempotent).
 *
 * @throws Error if directory creation fails due to permissions
 */
export function ensureSessionDir(): void {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
