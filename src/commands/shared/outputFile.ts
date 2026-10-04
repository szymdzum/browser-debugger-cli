/**
 * Writing files the user asked for (screenshots, HAR exports), with errors
 * that name their path and say what is wrong with it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CommandError } from '@/errors/index.js';
import { emptyOutputPathError, outputFileError } from '@/errors/messages.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** What went wrong with a path, by error code */
const PATH_PROBLEMS: Record<string, { reason: string; exitCode: number }> = {
  EACCES: { reason: 'permission denied', exitCode: EXIT_CODES.PERMISSION_DENIED },
  EPERM: { reason: 'operation not permitted', exitCode: EXIT_CODES.PERMISSION_DENIED },
  EROFS: { reason: 'read-only file system', exitCode: EXIT_CODES.PERMISSION_DENIED },
  EISDIR: { reason: 'it is a directory', exitCode: EXIT_CODES.INVALID_ARGUMENTS },
  ENOTDIR: { reason: 'a part of the path is a file', exitCode: EXIT_CODES.INVALID_ARGUMENTS },
  EEXIST: { reason: 'a part of the path is a file', exitCode: EXIT_CODES.INVALID_ARGUMENTS },
  ENAMETOOLONG: { reason: 'the name is too long', exitCode: EXIT_CODES.INVALID_ARGUMENTS },
  ENOENT: { reason: 'the directory cannot be created', exitCode: EXIT_CODES.INVALID_ARGUMENTS },
  ENOSPC: { reason: 'no space left on the device', exitCode: EXIT_CODES.SESSION_FILE_ERROR },
};

/**
 * A file-system error as a user-facing error about the given path.
 *
 * @param filePath - Path the user gave
 * @param error - Error from the file system
 * @returns Command error (81 bad path, 82 not permitted, 103 disk problem)
 */
export function outputPathError(filePath: string, error: unknown): CommandError {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  const problem = PATH_PROBLEMS[code];
  const reason = problem?.reason ?? (error instanceof Error ? error.message : String(error));
  const err = outputFileError(filePath, reason);
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    problem?.exitCode ?? EXIT_CODES.SESSION_FILE_ERROR
  );
}

/**
 * Reject an empty path or one that names a directory.
 *
 * @param filePath - Path the user gave
 * @throws CommandError (81) when the path cannot be a file
 */
export function assertFilePath(filePath: string): void {
  if (!filePath.trim()) {
    const err = emptyOutputPathError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    throw outputPathError(filePath, Object.assign(new Error('directory'), { code: 'EISDIR' }));
  }
}

/**
 * Write a file atomically, creating its directory if needed.
 *
 * @param filePath - Path the user gave
 * @param data - File contents
 * @returns Absolute path written
 * @throws CommandError naming the path when it cannot be written
 */
export async function writeOutputFile(filePath: string, data: string | Buffer): Promise<string> {
  assertFilePath(filePath);
  const absolutePath = path.resolve(filePath);
  try {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    if (typeof data === 'string') await AtomicFileWriter.writeAsync(absolutePath, data);
    else await AtomicFileWriter.writeBufferAsync(absolutePath, data);
  } catch (error) {
    throw outputPathError(filePath, error);
  }
  return absolutePath;
}
