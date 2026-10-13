/**
 * Transport Error Formatting
 *
 * Formats transport-layer errors with context using structured error classes.
 */

import { CommandError } from '@/errors/index.js';
import { replyTooLargeError } from '@/errors/messages.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import type { JSONLBufferOverflowError } from './jsonl.js';
import {
  IPCCancelledError,
  IPCConnectionError,
  IPCParseError,
  IPCTimeoutError,
  IPCEarlyCloseError,
} from './IPCError.js';

export function formatConnectionError(
  requestName: string,
  socketPath: string,
  error: Error
): IPCConnectionError {
  const code = (error as NodeJS.ErrnoException).code;
  const message = [
    `IPC ${requestName} connection error`,
    `Socket: ${socketPath}`,
    ...(code ? [`Code: ${code}`] : []),
    `Details: ${error.message}`,
  ].join(' | ');
  return new IPCConnectionError(message, socketPath, code);
}

export function formatParseError(requestName: string, error: unknown): IPCParseError {
  const cause = error instanceof Error ? error : undefined;
  return new IPCParseError(requestName, getErrorMessage(error), cause);
}

export function formatTimeoutError(requestName: string, timeoutMs: number): IPCTimeoutError {
  return new IPCTimeoutError(requestName, timeoutMs);
}

export function formatEarlyCloseError(requestName: string): IPCEarlyCloseError {
  return new IPCEarlyCloseError(requestName);
}

export function formatCancelledError(requestName: string): IPCCancelledError {
  return new IPCCancelledError(requestName);
}

/**
 * The error a command ends with when the daemon's reply is longer than the
 * client reads.
 *
 * @param error - The overflow the line buffer reported
 * @param request - Type of the request it answers
 * @returns Command error (81) naming the size and how to ask for less
 */
export function formatReplyOverflowError(
  error: JSONLBufferOverflowError,
  request: string
): CommandError {
  const err = replyTooLargeError(error.bufferSize, error.maxSize, request, false);
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.INVALID_ARGUMENTS
  );
}
