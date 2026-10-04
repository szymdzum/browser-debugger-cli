/**
 * Shared data fetching utilities for commands that query daemon state.
 */

import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { PeekSection } from '@/ipc/protocol/commands.js';
import {
  IPCConnectionError,
  IPCEarlyCloseError,
  IPCTimeoutError,
} from '@/ipc/transport/IPCError.js';
import { isConnectionError } from '@/ipc/utils/errors.js';
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

/** What to fetch from the daemon's preview. */
export interface PreviewQuery {
  /** Most recent items per section (0 = all; default: daemon default) */
  lastN?: number;
  /** Only network or only console items */
  only?: PeekSection;
  /** Include request/response headers in network items */
  withHeaders?: boolean;
}

/**
 * Fetch raw preview output from daemon.
 *
 * @param query - Window, section and header options
 * @returns Preview output or a fetch error
 */
export async function fetchPreviewOutput(
  query: PreviewQuery = {}
): Promise<FetchResult<BdgOutput>> {
  log.debug(`Fetching preview output ${JSON.stringify(query)}`);
  let response: Awaited<ReturnType<typeof getPeek>>;
  try {
    response = await getPeek(query);
  } catch (error) {
    if (error instanceof IPCTimeoutError) {
      return { success: false, error: getErrorMessage(error), exitCode: EXIT_CODES.CDP_TIMEOUT };
    }
    const gone =
      error instanceof IPCConnectionError ||
      error instanceof IPCEarlyCloseError ||
      isConnectionError(error);
    if (!gone) throw error;
    log.debug(`Daemon unreachable: ${getErrorMessage(error)}`);
    return {
      success: false,
      error: 'No active session (it ended or was never started)',
      exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
    };
  }

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
 *
 * @param query - Window, section and header options
 * @returns Preview data or a fetch error
 */
export async function fetchPreviewData(
  query: PreviewQuery = {}
): Promise<FetchResult<PreviewData>> {
  const result = await fetchPreviewOutput(query);
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
 * Fetch all captured network requests from daemon.
 *
 * @param withHeaders - Include request/response headers (needed by header filters)
 * @returns Requests or a fetch error
 */
export async function fetchNetworkRequests(
  withHeaders = false
): Promise<FetchResult<NetworkRequest[]>> {
  const result = await fetchPreviewData({ lastN: 0, only: 'network', withHeaders });
  if (!result.success) return result;
  return { success: true, data: result.data.network };
}

/**
 * Fetch console messages from daemon.
 */
export async function fetchConsoleMessages(): Promise<FetchResult<ConsoleMessage[]>> {
  const result = await fetchPreviewData({ lastN: 0, only: 'console' });
  if (!result.success) return result;
  return { success: true, data: result.data.console };
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
