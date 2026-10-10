/**
 * Writing a file the user named without harming what is there: the data goes
 * to a new temp file next to the target (created with `O_EXCL|O_NOFOLLOW`,
 * so never an existing file or a symlink) and is renamed over the target
 * only once complete. An existing regular file keeps its mode; a symlink at
 * the target is replaced by the file (its destination is left as it was).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Flags of a temp file: created new (never an existing file or a symlink) */
export const TEMP_FILE_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  (fs.constants.O_NOFOLLOW ?? 0);

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
 * Write a whole file through a temp file renamed over the target.
 *
 * @param file - Absolute path of the target (its directory must exist)
 * @param data - Contents
 * @param mode - Mode of a new file (an existing regular file keeps its own)
 * @throws The file-system error (the temp file is removed); EISDIR for a directory
 */
export async function writeFileSafely(file: string, data: string, mode: number): Promise<void> {
  const target = await fs.promises.stat(file).catch(() => undefined);
  if (target?.isDirectory()) throw Object.assign(new Error('directory'), { code: 'EISDIR' });
  const existing = await fs.promises.lstat(file).catch(() => undefined);
  const temp = tempPathFor(file);
  const handle = await fs.promises.open(temp, TEMP_FILE_FLAGS, mode);
  try {
    await handle.chmod(existing?.isFile() ? existing.mode & 0o7777 : mode);
    await handle.writeFile(data, 'utf8');
    await handle.close();
    await fs.promises.rename(temp, file);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.promises.rm(temp, { force: true });
    throw error;
  }
}
