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

/**
 * Read and validate a state file.
 *
 * @param file - Path given
 * @returns Cookies and origins
 * @throws CommandError (81) when it cannot be read or is not a valid state file
 */
export function readStateFile(file: string): AuthStateContent {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    const err = invalidStateFileError(file, READ_PROBLEMS[code] ?? 'it cannot be read');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return parseStateFile(text, file);
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
