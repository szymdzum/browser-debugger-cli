/**
 * Shared data fetching utilities for commands that query daemon state.
 */

import { sessionNotRespondingError, sessionUnavailableSuggestion } from '@/errors/messages.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { PeekSection } from '@/ipc/protocol/commands.js';
import type { TabSwitchInfo } from '@/ipc/protocol/tabTypes.js';
import {
  IPCConnectionError,
  IPCEarlyCloseError,
  IPCTimeoutError,
} from '@/ipc/transport/IPCError.js';
import { isConnectionError } from '@/ipc/utils/errors.js';
import type { BdgOutput, ConsoleMessage, NetworkRequest, PageIssue } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import type { NetworkEvictionCounts } from '@/ui/messages/networkMessages.js';
import { noActiveSessionMessage } from '@/ui/messages/sessionCommand.js';
import { getExitCodeForConnectionError } from '@/utils/errorMapping.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('fetcher');

export type FetchSuccess<T> = { success: true; data: T };
export type FetchError = {
  success: false;
  error: string;
  exitCode: number;
  /** What the user can do about it (default: start a session) */
  suggestion?: string;
};
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
  /** Take a move of the session to another tab that no command reported yet, for this command to report */
  tabMove?: boolean;
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
      const err = sessionNotRespondingError(error.timeoutMs / 1000);
      return {
        success: false,
        error: err.message,
        exitCode: EXIT_CODES.CDP_TIMEOUT,
        suggestion: err.suggestion,
      };
    }
    const gone =
      error instanceof IPCConnectionError ||
      error instanceof IPCEarlyCloseError ||
      isConnectionError(error);
    if (!gone) throw error;
    log.debug(`Daemon unreachable: ${getErrorMessage(error)}`);
    return {
      success: false,
      error: noActiveSessionMessage(),
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
 * @param tabMove - Take a move to another tab no command reported yet (see {@link PreviewQuery})
 * @returns Requests, the navigation id of the page currently loaded, when
 *   the page crashed (while it is not loaded again),
 *   the session's latest move to another tab and what the session let go at
 *   its capture limits, or a fetch error
 */
export async function fetchNetworkRequests(
  withHeaders = false,
  tabMove = false
): Promise<
  FetchResult<{
    requests: NetworkRequest[];
    currentNavigationId: number | undefined;
    pageCrashedAt: number | undefined;
    tabSwitch: TabSwitchInfo | undefined;
    evictions: NetworkEvictionCounts;
  }>
> {
  const result = await fetchPreviewData({ lastN: 0, only: 'network', withHeaders, tabMove });
  if (!result.success) return result;
  const { totals, pageCrashedAt, tabSwitch, currentNavigationId } = result.data.output;
  return {
    success: true,
    data: {
      requests: result.data.network,
      currentNavigationId,
      pageCrashedAt,
      tabSwitch,
      evictions: {
        requestsDropped: totals?.networkDropped ?? 0,
        bodiesEvicted: totals?.networkBodiesEvicted ?? 0,
      },
    },
  };
}

/**
 * Fetch all console messages from daemon.
 *
 * @param tabMove - Take a move to another tab no command reported yet (see {@link PreviewQuery})
 * @returns Messages (with their session-wide index), the navigation id of
 *   the page currently loaded, how many of the oldest messages the session
 *   dropped at its limit, when the page crashed (while it is not loaded
 *   again), the session's latest move to another tab, and the page's Chrome
 *   Issues with how many were not kept
 */
export async function fetchConsoleMessages(tabMove = false): Promise<
  FetchResult<{
    messages: ConsoleMessage[];
    currentNavigationId: number | undefined;
    dropped: number;
    pageCrashedAt: number | undefined;
    tabSwitch: TabSwitchInfo | undefined;
    issues: PageIssue[];
    issuesDropped: number;
  }>
> {
  const result = await fetchPreviewData({ lastN: 0, only: 'console', tabMove });
  if (!result.success) return result;
  return {
    success: true,
    data: {
      messages: result.data.console,
      currentNavigationId: result.data.output.currentNavigationId,
      dropped: result.data.output.totals?.consoleDropped ?? 0,
      pageCrashedAt: result.data.output.pageCrashedAt,
      tabSwitch: result.data.output.tabSwitch,
      issues: result.data.output.data.issues ?? [],
      issuesDropped: result.data.output.totals?.issuesDropped ?? 0,
    },
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
  suggestion = sessionUnavailableSuggestion(exitCode)
): ErrorResult {
  return {
    success: false,
    error,
    exitCode,
    errorContext: { suggestion },
  };
}
