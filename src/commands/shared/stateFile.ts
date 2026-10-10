/**
 * Reading and writing the state files of `bdg state save`, `bdg state load`
 * and `bdg <url> --state`. The file holds secrets: a new one is created
 * readable by its owner only (0600).
 */

import * as fs from 'fs';
import * as path from 'path';

import { assertFilePath, outputPathError } from '@/commands/shared/outputFile.js';
import { CommandError } from '@/errors/index.js';
import type { AuthStateContent } from '@/ipc/protocol/stateTypes.js';
import { invalidStateFileError } from '@/ui/messages/stateMessages.js';
import { buildStateFile, parseStateFile } from '@/utils/authStateFormat.js';
import { makeDirectory } from '@/utils/directories.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { writeFileSafely } from '@/utils/safeFile.js';

/** Mode of a new state file: readable by its owner only */
export const STATE_FILE_MODE = 0o600;

/** Why a state file cannot be read, by error code */
const READ_PROBLEMS: Record<string, string> = {
  ENOENT: 'the file does not exist',
  EISDIR: 'it is a directory',
  EACCES: 'permission denied',
  EPERM: 'operation not permitted',
};

/** Largest state file read (50 MB): a real one is a few KB */
export const STATE_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Flags to open a state file: never blocks on a FIFO or device */
const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);

/**
 * Throw the error of a state file that cannot be read.
 *
 * @param file - Path given
 * @param reason - Why
 * @throws CommandError (81)
 */
function unreadable(file: string, reason: string): never {
  const err = invalidStateFileError(file, reason);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Read a regular file of at most {@link STATE_FILE_MAX_BYTES}.
 *
 * @param file - Path given
 * @returns Its text
 * @throws CommandError (81) when it cannot be opened, is not a regular file or is too large
 */
function readRegularFile(file: string): string {
  let fd: number;
  try {
    fd = fs.openSync(file, READ_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    unreadable(file, READ_PROBLEMS[code] ?? 'it cannot be read');
  }
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory()) unreadable(file, 'it is a directory');
    if (!stat.isFile()) unreadable(file, 'it is not a regular file');
    if (stat.size > STATE_FILE_MAX_BYTES) unreadable(file, 'it is larger than 50 MB');
    return fs.readFileSync(fd, 'utf8');
  } catch (error) {
    if (error instanceof CommandError) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? '';
    return unreadable(file, READ_PROBLEMS[code] ?? 'it cannot be read');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read and validate a state file.
 *
 * @param file - Path given
 * @returns Cookies and origins
 * @throws CommandError (81) when it cannot be read, is not a regular file of
 *   at most 50 MB, or is not a valid state file
 */
export function readStateFile(file: string): AuthStateContent {
  return parseStateFile(readRegularFile(file), file);
}

/**
 * Write a state file: a new one 0600, an existing one keeps its mode; never
 * through a symlink or a partly written file.
 *
 * @param file - Path given
 * @param content - Cookies and origins
 * @returns Absolute path written
 * @throws CommandError naming the path when it cannot be written
 */
export async function writeStateFile(file: string, content: AuthStateContent): Promise<string> {
  assertFilePath(file, '.json');
  const absolutePath = path.resolve(file);
  try {
    makeDirectory(path.dirname(absolutePath));
    const text = `${JSON.stringify(buildStateFile(content), null, 2)}\n`;
    await writeFileSafely(absolutePath, text, STATE_FILE_MODE);
  } catch (error) {
    throw outputPathError(file, error, '.json');
  }
  return absolutePath;
}
