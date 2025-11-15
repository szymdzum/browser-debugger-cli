/**
 * Transport Error Formatting
 *
 * Formats transport-layer errors with context using structured error classes.
 */

import { getErrorMessage } from '@/utils/errors.js';

import {
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
