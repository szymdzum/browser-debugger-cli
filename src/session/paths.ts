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
import {
  dirTrustProblem,
  makeDirectory,
  type DirTrustKind,
  type DirTrustProblem,
} from '@/utils/directories.js';
import { getErrorMessage } from '@/utils/errors.js';

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
 * Files a running session keeps in its directory; left behind (stale) when
 * its daemon dies without tearing down.
 */
export const SESSION_STATE_FILES = [
  'DAEMON_PID',
  'DAEMON_SOCKET',
  'CHROME_PID',
  'METADATA',
] as const satisfies readonly SessionFileType[];

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
  const override = sessionDirOverride();
  if (override !== null) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }

  return path.join(os.homedir(), '.bdg');
}

/**
 * The base session directory the user chose with `$BDG_SESSION_DIR`.
 *
 * @returns The variable's value, or null when unset or blank (`~/.bdg`)
 */
function sessionDirOverride(): string | null {
  const override = process.env[SESSION_DIR_OVERRIDE_ENV];
  return override && override.trim().length > 0 ? override : null;
}

/**
 * The selected session name (`--session` / `BDG_SESSION`), lower-cased:
 * session names are case-insensitive.
 *
 * @returns Session name, or null for the default session
 */
export function getSessionName(): string | null {
  const name = process.env[SESSION_NAME_ENV]?.trim();
  if (!name) return null;
  return name.toLowerCase();
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
 * Which session a directory holds, from its location: `<base>/sessions/<name>`
 * is a named session, any other directory a default session (its own base).
 *
 * @param dir - Absolute session directory
 * @returns Session name (null for a default session) and base directory
 */
export function sessionOfDir(dir: string): { name: string | null; baseDir: string } {
  const parent = path.dirname(dir);
  if (path.basename(parent) === NAMED_SESSIONS_DIR) {
    return { name: path.basename(dir), baseDir: path.dirname(parent) };
  }
  return { name: null, baseDir: dir };
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

/** Mode of the session directories bdg creates: only the user can enter them */
const PRIVATE_DIR_MODE = 0o700;

/** Permission bits that give group or others any access */
const GROUP_OTHER_ACCESS = 0o077;

/**
 * Ensure the session directory exists.
 *
 * Creates it, and missing parents (the base directory, `sessions/`), with
 * mode 0700. Safe to call multiple times (idempotent). A path that cannot
 * hold a directory is refused before `mkdir`, which would spin on a
 * pseudo-filesystem ({@link makeDirectory}).
 *
 * @throws Error if the directory cannot be created
 */
export function ensureSessionDir(): void {
  makeDirectory(getSessionDir(), PRIVATE_DIR_MODE);
}

/** Subdirectory of a session directory that a launched Chrome downloads into */
const DOWNLOADS_DIR = 'downloads';

/**
 * Ensure the session's downloads directory exists (mode 0700, like the
 * session directory) and return it.
 *
 * @returns Absolute path, `<session dir>/downloads`
 * @throws Error if the directory cannot be created
 */
export function ensureSessionDownloadsDir(): string {
  const dir = path.join(getSessionDir(), DOWNLOADS_DIR);
  makeDirectory(dir, PRIVATE_DIR_MODE);
  return dir;
}

/** A session directory (or one above it) that cannot be trusted */
export interface UntrustedSessionDir {
  /** The untrusted directory */
  dir: string;
  /** Why, e.g. `writable by others (mode 777)` */
  reason: string;
  kind: DirTrustKind;
  /** bdg owns it by convention (`~/.bdg`, `sessions/`, `sessions/<name>`) */
  bdgOwned: boolean;
}

/** Session directories need not keep group write out (umask 002 made them 0775) */
const SESSION_DIR_TRUST = { allowGroupWrite: true };

/** A directory a session directory's trust depends on */
interface ChainDir {
  dir: string;
  /**
   * bdg owns it by convention and may tighten it: the default `~/.bdg` and
   * everything under a base directory, not a `$BDG_SESSION_DIR` the user chose
   */
  bdgOwned: boolean;
  /** The base directory, which may be a symlink to a trusted directory */
  isBase: boolean;
}

/**
 * Directories whose trust a session directory depends on: the base
 * directory and each directory from it down to the session directory
 * (`<base>`, `<base>/sessions`, `<base>/sessions/<name>`), or the directory
 * alone when it is outside the base.
 *
 * @param dir - Session directory
 * @returns Directories, outermost first
 */
function sessionDirChain(dir: string): ChainDir[] {
  const base = getSessionBaseDir();
  const relative = path.relative(base, dir);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return [{ dir, bdgOwned: false, isBase: false }];
  }
  const chain: ChainDir[] = [{ dir: base, bdgOwned: sessionDirOverride() === null, isBase: true }];
  let current = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    chain.push({ dir: current, bdgOwned: true, isBase: false });
  }
  return chain;
}

/**
 * Remove group and other access from a directory of the user's (best
 * effort). The directory is opened without following a symlink and changed
 * through that descriptor, so a path swapped after the trust check is not
 * affected.
 *
 * @param dir - Trusted directory
 */
function tightenDir(dir: string): void {
  if (process.platform === 'win32') return;
  let fd: number | undefined;
  try {
    const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = fs.constants;
    fd = fs.openSync(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (stat.uid !== process.getuid?.() || (stat.mode & GROUP_OTHER_ACCESS) === 0) return;
    fs.fchmodSync(fd, PRIVATE_DIR_MODE);
    log.debug(`Session directory ${dir} restricted to mode 700`);
  } catch (error) {
    log.debug(`Session directory ${dir} not restricted: ${getErrorMessage(error)}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Why a directory of the chain cannot be trusted. The base directory alone
 * may be a symlink (`~/.bdg` kept with dotfiles or on another disk): its
 * target is checked instead. `sessions/` and session directories must be
 * real directories.
 *
 * @param entry - Directory of the chain
 * @returns The problem, or null when it can be trusted
 * @throws Error from `lstat`/`realpath` (e.g. `ENOENT`)
 */
function chainDirProblem(entry: ChainDir): DirTrustProblem | null {
  const problem = dirTrustProblem(entry.dir, SESSION_DIR_TRUST);
  if (problem?.kind !== 'symlink' || !entry.isBase) return problem;
  const target = fs.realpathSync(entry.dir);
  const targetProblem = dirTrustProblem(target, SESSION_DIR_TRUST);
  return (
    targetProblem && {
      ...targetProblem,
      reason: `it links to ${target}, which is ${targetProblem.reason}`,
    }
  );
}

/**
 * Accept a trusted directory: tighten it to 0700 when bdg owns it, leave a
 * directory the user chose as it is (noted in the debug log when group or
 * others can use it).
 *
 * @param entry - Trusted directory
 */
function acceptTrustedDir(entry: ChainDir): void {
  if (entry.bdgOwned) {
    tightenDir(entry.dir);
    return;
  }
  const mode = fs.statSync(entry.dir, { throwIfNoEntry: false })?.mode ?? 0;
  if ((mode & GROUP_OTHER_ACCESS) === 0) return;
  log.debug(
    `Session directory ${entry.dir} is open to group or others; left as is (chosen with ${SESSION_DIR_OVERRIDE_ENV})`
  );
}

/**
 * Check that a session directory and the directories above it up to the base
 * directory can be trusted before a daemon is started there or its socket is
 * connected to: another user who can write to one of them could replace the
 * socket (and receive every command) or plant files. Each existing directory
 * must be a real directory (not a symlink), owned by the user, and not
 * writable by others ({@link dirTrustProblem}); group write is accepted, since
 * under umask 002 (per-user groups) older versions created `~/.bdg` 0775.
 * The base directory may be a symlink whose target passes the same rule
 * ({@link chainDirProblem}). A directory owned by another uid (a bind mount,
 * `sudo -E`) is refused.
 *
 * Trusted directories bdg owns (the default `~/.bdg`, `sessions/` and named
 * session directories) that group or others can still use are tightened to
 * 0700; a base directory chosen with `$BDG_SESSION_DIR`, or a symlinked base
 * (opened without following links), is never changed.
 * Missing paths are skipped (as is a path through a file, which fails on its
 * own): {@link ensureSessionDir} creates them 0700.
 *
 * @param dir - Session directory (default: the selected session's)
 * @returns The first untrusted directory and why, or null
 */
export function secureSessionDir(dir: string = getSessionDir()): UntrustedSessionDir | null {
  for (const entry of sessionDirChain(dir)) {
    let problem: DirTrustProblem | null;
    try {
      problem = chainDirProblem(entry);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      problem = { reason: getErrorMessage(error), kind: 'not-directory' };
    }
    if (problem !== null) return { dir: entry.dir, ...problem, bdgOwned: entry.bdgOwned };
    acceptTrustedDir(entry);
  }
  return null;
}
