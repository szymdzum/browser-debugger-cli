/**
 * Transport Error Formatting
 *
 * Formats transport-layer errors with context.
 */

import { getErrorMessage } from '@/ui/errors/index.js';

export function formatConnectionError(
  requestName: string,
  socketPath: string,
  error: Error
): Error {
  const code = (error as NodeJS.ErrnoException).code;
  const fullMessage = [
    `IPC ${requestName} connection error`,
    `Socket: ${socketPath}`,
    ...(code ? [`Code: ${code}`] : []),
    `Details: ${error.message}`,
  ].join(' | ');
  return new Error(fullMessage);
}

export function formatParseError(requestName: string, error: unknown): Error {
  return new Error(`Failed to parse ${requestName} response: ${getErrorMessage(error)}`);
}

export function formatTimeoutError(requestName: string, timeoutMs: number): Error {
  return new Error(`${requestName} request timeout after ${timeoutMs / 1000}s`);
}

export function formatEarlyCloseError(requestName: string): Error {
  return new Error(`Connection closed before ${requestName} response received`);
}
