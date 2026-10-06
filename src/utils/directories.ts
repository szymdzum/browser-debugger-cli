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
