/**
 * Writing a file the user named without harming what is there: the data goes
 * to a new temp file next to the target (created with `O_EXCL|O_NOFOLLOW`,
 * so never an existing file or a symlink) and is renamed over the target
 * only once complete. The file gets the mode asked for, also when it
 * replaces an existing file of another mode (the rename replaces the inode,
 * so the old mode does not carry over; #624). A symlink to a regular file is
 * written through: the temp file goes next to the file it points to and
 * replaces that file, so the link stays. A target that is neither missing
 * nor a regular file (a FIFO, device, socket or directory, or a symlink to
 * one of these or to a missing path) is refused, never replaced (#895).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { createTrackedTempFile } from '@/utils/tempFiles.js';

/** Set the mode of an open file */
const changeFdMode = promisify(fs.fchmod);

/** Write a whole file through its descriptor */
const writeToFd = promisify(fs.writeFile);

/** Close a file descriptor */
const closeFd = promisify(fs.close);

/** Flags of a temp file: created new (never an existing file or a symlink) */
export const TEMP_FILE_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  (fs.constants.O_NOFOLLOW ?? 0);

/**
 * An error with a code, for a target that cannot be written.
 *
 * @param code - Error code (`EISDIR`, `ENOTREGULAR`, `EDANGLING`)
 * @returns The error
 */
function targetError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/**
 * Check that an existing target is a regular file.
 *
 * @param stat - Stat of the target (symlinks followed)
 * @throws EISDIR for a directory, ENOTREGULAR for a FIFO, device or socket
 */
function assertRegularFile(stat: fs.Stats): void {
  if (stat.isDirectory()) throw targetError('EISDIR');
  if (!stat.isFile()) throw targetError('ENOTREGULAR');
}

/**
 * The path a write to a target renames its temp file over: the target when
 * it is missing or a regular file, the file a symlink points to when that is
 * a regular file (so the link stays and that file gets the data; #895).
 *
 * @param file - Absolute path of the target
 * @returns Absolute path to replace
 * @throws EISDIR for a directory, ENOTREGULAR for a FIFO, device or socket
 *   (also behind a symlink), EDANGLING for a symlink to a missing path;
 *   other file-system errors (ELOOP, EACCES) as they are
 */
export async function resolveWriteTarget(file: string): Promise<string> {
  const entry = await fs.promises.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!entry) return file;
  if (!entry.isSymbolicLink()) {
    assertRegularFile(entry);
    return file;
  }
  const real = await fs.promises.realpath(file).catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? targetError('EDANGLING') : error;
  });
  assertRegularFile(await fs.promises.stat(real));
  return real;
}

/** Temp files created by this process, for unique names */
let tempFileCount = 0;

/** Longest file name most file systems allow, in bytes */
const MAX_NAME_BYTES = 255;

/**
 * Path of a new temp file next to a target: `.<name>.<pid>.<n>.tmp`, with
 * a hash of the name instead when the name leaves no room for the suffix.
 *
 * @param file - Absolute path of the target
 * @returns Temp file path
 */
export function tempPathFor(file: string): string {
  const suffix = `.${process.pid}.${++tempFileCount}.tmp`;
  const name = path.basename(file);
  const fits = Buffer.byteLength(`.${name}${suffix}`) <= MAX_NAME_BYTES;
  const stem = fits ? name : createHash('sha256').update(name).digest('hex').slice(0, 16);
  return path.join(path.dirname(file), `.${stem}${suffix}`);
}

/**
 * Write a whole file through a temp file renamed over the target, or over
 * the regular file a symlink at the target points to.
 *
 * @param file - Absolute path of the target (its directory must exist)
 * @param data - Contents
 * @param mode - Mode of the file, set exactly (not reduced by the umask), also
 *   when it replaces an existing file
 * @throws The file-system error (the temp file is removed, also when the
 *   process exits first: Ctrl-C, SIGTERM); the errors of
 *   {@link resolveWriteTarget} for a target that is not a regular file
 */
export async function writeFileSafely(file: string, data: string, mode: number): Promise<void> {
  const target = await resolveWriteTarget(file);
  const temp = tempPathFor(target);
  const { fd, untrack } = createTrackedTempFile(temp, TEMP_FILE_FLAGS, mode);
  try {
    try {
      await changeFdMode(fd, mode);
      await writeToFd(fd, data, 'utf8');
    } finally {
      await closeFd(fd);
    }
    await fs.promises.rename(temp, target);
  } catch (error) {
    await fs.promises.rm(temp, { force: true });
    throw error;
  } finally {
    untrack();
  }
}
