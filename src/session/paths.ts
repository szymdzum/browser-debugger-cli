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
  DAEMON_PID: 'daemon.pid',
  DAEMON_SOCKET: 'daemon.sock',
  DAEMON_LOCK: 'daemon.lock',
} as const;

const SESSION_DIR_OVERRIDE_ENV = 'BDG_SESSION_DIR';

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
  const override = process.env[SESSION_DIR_OVERRIDE_ENV];
  if (override && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }

  return path.join(os.homedir(), '.bdg');
}

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
 * Get the path to the daemon's Unix domain socket.
 */
export function getDaemonSocketPath(): string {
  return getSessionFilePath('DAEMON_SOCKET');
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
