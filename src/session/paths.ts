/**
 * Session path generation and management.
 *
 * Centralized path generation for all session-related files in ~/.bdg/
 * (or `~/.bdg/sessions/<name>/` for a named session).
 * WHY: Single source of truth for file locations prevents path inconsistencies.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createLogger, logDebugError } from '@/ui/logging/index.js';

const log = createLogger('session');

/**
 * Session file paths relative to ~/.bdg/
 * Centralized definition for all session-related files.
 */
const SESSION_FILES = {
  OUTPUT: 'session.json',
  METADATA: 'session.meta.json',
  CHROME_PID: 'chrome.pid',
  DAEMON_PID: 'daemon.pid',
  DAEMON_SOCKET: 'daemon.sock',
  PORT: 'port.txt',
  LAST_SESSION: 'last-session.json',
} as const;

const SESSION_DIR_OVERRIDE_ENV = 'BDG_SESSION_DIR';

/** Environment variable holding the selected session name (set by `--session`) */
export const SESSION_NAME_ENV = 'BDG_SESSION';

/** Subdirectory of the base session directory that holds named sessions */
const NAMED_SESSIONS_DIR = 'sessions';

/** Longest Unix socket path (sun_path is 104 bytes on macOS, 108 on Linux, NUL included) */
export const MAX_SOCKET_PATH_BYTES = process.platform === 'darwin' ? 103 : 107;

/**
 * Longest public daemon socket path: the daemon first listens on
 * `<path>.<pid>` and then links it into place, so the pid suffix (up to 7
 * digits) must fit too.
 */
export const MAX_DAEMON_SOCKET_PATH_BYTES = MAX_SOCKET_PATH_BYTES - '.9999999'.length;

/**
 * A session directory: the default session (`name` null) or a named one.
 */
export interface SessionDirEntry {
  /** Session name, or null for the default session */
  name: string | null;
  /** Absolute session directory */
  dir: string;
}

/**
 * Session file type for type-safe path generation
 */
export type SessionFileType = keyof typeof SESSION_FILES;

/**
 * Get the base session directory: `$BDG_SESSION_DIR`, else `~/.bdg`.
 *
 * It is the default session's directory and holds named sessions under
 * `sessions/<name>/`. Uses os.homedir() dynamically to support test
 * environment variable changes.
 *
 * @returns Full path to the base session directory
 */
export function getSessionBaseDir(): string {
  const override = process.env[SESSION_DIR_OVERRIDE_ENV];
  if (override && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }

  return path.join(os.homedir(), '.bdg');
}

/**
 * The selected session name (`--session` / `BDG_SESSION`).
 *
 * @returns Session name, or null for the default session
 */
export function getSessionName(): string | null {
  const name = process.env[SESSION_NAME_ENV]?.trim();
  if (!name) return null;
  return name;
}

/**
 * Directory of a named session.
 *
 * @param name - Session name
 * @returns `<base>/sessions/<name>`
 */
export function getNamedSessionDir(name: string): string {
  return path.join(getSessionBaseDir(), NAMED_SESSIONS_DIR, name);
}

/**
 * Get the directory of the selected session: the base directory for the
 * default session, `<base>/sessions/<name>` for a named one.
 *
 * @returns Full path to the session directory
 */
export function getSessionDir(): string {
  const name = getSessionName();
  return name === null ? getSessionBaseDir() : getNamedSessionDir(name);
}

/**
 * Every session directory on disk: the default one, then named sessions
 * sorted by name. Directories need not hold a running session.
 *
 * @returns Session directory entries
 */
export function listSessionDirs(): SessionDirEntry[] {
  const namedRoot = path.join(getSessionBaseDir(), NAMED_SESSIONS_DIR);
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(namedRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    logDebugError(log, `list ${namedRoot}`, error);
  }
  return [
    { name: null, dir: getSessionBaseDir() },
    ...names.map((name) => ({ name, dir: path.join(namedRoot, name) })),
  ];
}

/**
 * Path of a session file in a given session directory.
 *
 * @param dir - Session directory
 * @param fileType - The type of session file
 * @returns Full path to the file
 */
export function sessionFilePathIn(dir: string, fileType: SessionFileType): string {
  return path.join(dir, SESSION_FILES[fileType]);
}

/**
 * Get the path to a session file by type.
 *
 * @param fileType - The type of session file
 * @returns Full path to the session file
 *
 * @example
 * ```typescript
 * getSessionFilePath('METADATA')   // → ~/.bdg/session.meta.json
 * getSessionFilePath('DAEMON_PID') // → ~/.bdg/daemon.pid
 * ```
 */
export function getSessionFilePath(fileType: SessionFileType): string {
  return sessionFilePathIn(getSessionDir(), fileType);
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
