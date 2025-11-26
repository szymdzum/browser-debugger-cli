/**
 * Shared data fetching utilities for commands that query daemon state.
 */

import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { BdgOutput, ConsoleMessage, NetworkRequest } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getExitCodeForConnectionError } from '@/utils/errorMapping.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('fetcher');

export type FetchSuccess<T> = { success: true; data: T };
export type FetchError = { success: false; error: string; exitCode: number };
export type FetchResult<T> = FetchSuccess<T> | FetchError;

interface PreviewData {
  output: BdgOutput;
  network: NetworkRequest[];
  console: ConsoleMessage[];
}

/**
 * Fetch raw preview output from daemon.
 */
export async function fetchPreviewOutput(lastN?: number): Promise<FetchResult<BdgOutput>> {
  log.debug(`Fetching preview output${lastN !== undefined ? ` (lastN: ${lastN})` : ''}`);
  const response = await getPeek(lastN !== undefined ? { lastN } : undefined);

  try {
    validateIPCResponse(response);
  } catch (validationError) {
    const errorMsg = getErrorMessage(validationError);
    const exitCode = getExitCodeForConnectionError(errorMsg);
    log.debug(`IPC validation failed: ${errorMsg}`);
    return { success: false, error: errorMsg, exitCode };
  }

  const output = response.data?.preview as BdgOutput | undefined;
  if (!output) {
    log.debug('No preview data in response');
    return {
      success: false,
      error: 'No preview data in response',
      exitCode: EXIT_CODES.SESSION_FILE_ERROR,
    };
  }

  log.debug('Preview output fetched successfully');
  return { success: true, data: output };
}

/**
 * Fetch preview data with parsed network and console arrays.
 */
export async function fetchPreviewData(lastN?: number): Promise<FetchResult<PreviewData>> {
  const result = await fetchPreviewOutput(lastN);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      output: result.data,
      network: result.data.data.network ?? [],
      console: result.data.data.console ?? [],
    },
  };
}

/**
 * Fetch network requests from daemon.
 */
export async function fetchNetworkRequests(): Promise<FetchResult<NetworkRequest[]>> {
  const result = await fetchPreviewData();
  if (!result.success) return result;
  return { success: true, data: result.data.network };
}

/**
 * Fetch console messages from daemon.
 */
export async function fetchConsoleMessages(): Promise<FetchResult<ConsoleMessage[]>> {
  const result = await fetchPreviewData(0);
  if (!result.success) return result;
  return { success: true, data: result.data.console };
}

/**
 * Create error result for daemon not running.
 */
export function createDaemonNotRunningError(): FetchError {
  return {
    success: false,
    error: 'Daemon not running',
    exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
  };
}

interface ErrorResult {
  success: false;
  error: string;
  exitCode: number;
  errorContext: { suggestion: string };
}

/**
 * Create command result with suggestion.
 *
 * @param error - Error message
 * @param exitCode - Exit code for the error
 * @param suggestion - Suggestion text for the user
 * @returns Error result object
 */
export function createErrorResult(
  error: string,
  exitCode: number,
  suggestion = 'Start a session with: bdg <url>'
): ErrorResult {
  return {
    success: false,
    error,
    exitCode,
    errorContext: { suggestion },
  };
}
