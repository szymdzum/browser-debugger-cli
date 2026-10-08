/**
 * Checks for a directory bdg is about to create and write (the session
 * directory, a Chrome profile) before it touches it: `fs.mkdirSync` with
 * `recursive` spins forever on Linux pseudo-filesystems (`/proc/x` kept a
 * start at full CPU until SIGKILL), and a profile Chrome cannot use wedges
 * the session.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Pseudo-filesystems no directory can be created on */
const PSEUDO_FILESYSTEM = /^\/(proc|sys)(\/|$)/;

/** Why a directory cannot be used, and whether it is a permission problem */
export interface DirectoryProblem {
  /** e.g. `/proc is a pseudo-filesystem`, `/tmp/x is a file`, `EACCES` */
  reason: string;
  /** Permission denied (or a read-only file system) rather than a wrong path */
  denied: boolean;
}

/**
 * Nearest path at or above `dir` that exists.
 *
 * @param dir - Absolute path
 * @returns The path itself, or its nearest existing ancestor
 */
function nearestExisting(dir: string): string {
  let current = dir;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

/**
 * Why `dir` cannot be created or written: it (or the path to it) is on a
 * pseudo-filesystem, a part of it is a file, or its nearest existing
 * directory is not writable.
 *
 * @param dir - Directory path (resolved against the working directory)
 * @returns The problem, or null when the directory can be used
 */
export function directoryProblem(dir: string): DirectoryProblem | null {
  const resolved = path.resolve(dir);
  const existing = nearestExisting(resolved);
  let real: string;
  try {
    real = fs.realpathSync(existing);
  } catch (error) {
    return { reason: (error as NodeJS.ErrnoException).code ?? String(error), denied: false };
  }
  if (PSEUDO_FILESYSTEM.test(resolved) || PSEUDO_FILESYSTEM.test(real)) {
    const root = (PSEUDO_FILESYSTEM.exec(resolved) ?? PSEUDO_FILESYSTEM.exec(real))?.[0] ?? '';
    return { reason: `${root.replace(/\/$/, '')} is a pseudo-filesystem`, denied: false };
  }
  if (!fs.statSync(real).isDirectory()) {
    return {
      reason: existing === resolved ? 'it is a file' : `${existing} is a file`,
      denied: false,
    };
  }
  try {
    fs.accessSync(real, fs.constants.W_OK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    return { reason: `${existing} is not writable (${code})`, denied: true };
  }
  return null;
}

/**
 * Create a directory (and its parents) after {@link directoryProblem} found
 * nothing wrong, so a pseudo-filesystem fails at once instead of spinning.
 *
 * @param dir - Directory to create
 * @param mode - Permissions of the directories created
 * @throws Error with `code` `EPSEUDOFS` (pseudo-filesystem), `ENOTDIR` (a
 *   file on the path), `EACCES` (not writable), or the `mkdir` error
 */
export function makeDirectory(dir: string, mode?: number): void {
  if (fs.existsSync(dir)) return;
  const problem = directoryProblem(dir);
  if (problem) {
    const code = problem.denied
      ? 'EACCES'
      : /pseudo-filesystem/.test(problem.reason)
        ? 'EPSEUDOFS'
        : 'ENOTDIR';
    throw Object.assign(new Error(problem.reason), { code });
  }
  fs.mkdirSync(dir, { recursive: true, ...(mode !== undefined && { mode }) });
}

/** Permission bits that let group or others write */
const GROUP_OTHER_WRITE = 0o022;

/** Permission bit that lets others (not the group) write */
const OTHER_WRITE = 0o002;

/** Sticky bit: a shared directory like `/tmp` where only owners remove their entries */
const STICKY = 0o1000;

/**
 * Kind of untrusted directory: a symlink, not a directory, another user's,
 * a shared sticky directory such as `/tmp` (others may create entries in
 * it), or writable by others
 */
export type DirTrustKind = 'symlink' | 'not-directory' | 'owner' | 'shared' | 'writable';

/** Why a directory cannot be trusted */
export interface DirTrustProblem {
  /** e.g. `owned by uid 1001`, `writable by others (mode 777)` */
  reason: string;
  kind: DirTrustKind;
}

/** Options of {@link dirTrustProblem} */
export interface DirTrustOptions {
  /**
   * Accept a directory its group may write to (only others' write access is
   * refused): under umask 002, common with per-user groups, directories are
   * created 0775 and the group holds only the user
   */
  allowGroupWrite?: boolean;
}

/**
 * Whether a path is a directory the current user can trust: a real directory
 * (not a symlink), owned by the user, not writable by group or others (by
 * others only, with `allowGroupWrite`).
 *
 * @param dir - Existing path
 * @param options - What else to accept
 * @returns Why it cannot be trusted, or null if it can
 * @throws Error from `lstat` (e.g. `ENOENT` for a missing path)
 */
export function dirTrustProblem(
  dir: string,
  options: DirTrustOptions = {}
): DirTrustProblem | null {
  const stat = fs.lstatSync(dir);
  const problem = (reason: string, kind: DirTrustKind): DirTrustProblem => ({ reason, kind });
  if (stat.isSymbolicLink()) return problem('it is a symbolic link', 'symlink');
  if (!stat.isDirectory()) return problem('not a directory', 'not-directory');
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) return problem(`owned by uid ${stat.uid}`, 'owner');
  if (process.platform === 'win32') return null;
  const writeBits = options.allowGroupWrite ? OTHER_WRITE : GROUP_OTHER_WRITE;
  if ((stat.mode & writeBits) === 0) return null;
  const mode = (stat.mode & 0o7777).toString(8);
  if ((stat.mode & STICKY) !== 0 && (stat.mode & OTHER_WRITE) !== 0) {
    return problem(`a shared sticky directory (mode ${mode})`, 'shared');
  }
  return problem(`writable by others (mode ${mode})`, 'writable');
}

/**
 * Strict form of {@link dirTrustProblem}: not a symlink, owned by the user,
 * not writable by group or others.
 *
 * @param dir - Existing path
 * @returns Why it cannot be trusted, or null if it can
 * @throws Error from `lstat` (e.g. `ENOENT` for a missing path)
 */
export function untrustedDirReason(dir: string): string | null {
  return dirTrustProblem(dir)?.reason ?? null;
}
