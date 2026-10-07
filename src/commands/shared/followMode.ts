/**
 * Shared utilities for follow/watch mode in commands.
 *
 * Provides a unified pattern for commands that continuously poll
 * and display updates (like tail -f behavior).
 */

import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { genericError } from '@/errors/messages.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** What a refresh asks for: nothing to keep following, or the exit code to stop with */
export type FollowPoll = { exitCode: number } | undefined;

/**
 * Report a failed fetch in follow mode: a lost connection is reported and
 * retried while the session was seen before, otherwise follow mode stops.
 *
 * @param failure - The fetch's error and exit code
 * @param options - JSON output and the retry interval shown
 * @returns The exit code to stop with, or undefined to keep following
 */
export function followFetchFailure(
  failure: { error: string; exitCode?: number | undefined },
  options: { json?: boolean | undefined; retryIntervalMs: number }
): FollowPoll {
  const result = handleDaemonConnectionError(failure.error, {
    json: options.json,
    follow: true,
    retryIntervalMs: options.retryIntervalMs,
    exitCode: failure.exitCode,
  });
  return result.shouldExit
    ? { exitCode: result.exitCode ?? EXIT_CODES.RESOURCE_NOT_FOUND }
    : undefined;
}

/**
 * Report each page crash of a stream once: a page loaded again that crashes
 * again is a new crash.
 *
 * @returns Function taking the crash time a refresh fetched, returning it
 *   when that crash was not reported yet
 */
export function newPageCrashes(): (crashedAt: number | undefined) => number | undefined {
  let reported: number | undefined;
  return (crashedAt) => {
    if (crashedAt === undefined || crashedAt === reported) return undefined;
    reported = crashedAt;
    return crashedAt;
  };
}

/**
 * Options for configuring follow mode behavior.
 */
export interface FollowModeOptions {
  /** Function that returns the "started following" message */
  startMessage: () => string;
  /** Function that returns the "stopped following" message */
  stopMessage: () => string;
  /** Polling interval in milliseconds (default: 1000) */
  intervalMs?: number;
}

/**
 * Sets up follow mode with periodic refresh and graceful shutdown.
 *
 * This helper eliminates duplicated follow-mode setup code across commands.
 * It handles:
 * - Initial display of start message
 * - First refresh call (awaited)
 * - Periodic interval-based refresh
 * - SIGINT/SIGTERM handlers that stop with 130/143, as shells expect
 * - Stopping with the exit code a refresh returns (e.g. the session is gone)
 *
 * @param refreshFn - Async function to call on each refresh cycle
 * @param options - Configuration options for follow mode
 *
 * @example
 * ```typescript
 * setupFollowMode(
 *   async () => {
 *     const data = await fetchData();
 *     displayData(data);
 *   },
 *   {
 *     startMessage: () => followingPreviewMessage(),
 *     stopMessage: () => stoppedFollowingPreviewMessage(),
 *     intervalMs: 1000,
 *   }
 * );
 * ```
 */
export async function setupFollowMode(
  refreshFn: () => Promise<FollowPoll>,
  options: FollowModeOptions
): Promise<void> {
  const { startMessage, stopMessage, intervalMs = 1000 } = options;
  const stopIfAsked = (poll: FollowPoll): void => {
    if (poll) process.exit(poll.exitCode);
  };

  console.error(startMessage());
  stopIfAsked(await refreshFn());

  const intervalId = setInterval(() => {
    refreshFn()
      .then(stopIfAsked)
      .catch((error: unknown) => {
        console.error(genericError(getErrorMessage(error)));
      });
  }, intervalMs);

  const stop = (exitCode: number): void => {
    clearInterval(intervalId);
    console.error(stopMessage());
    process.exit(exitCode);
  };
  process.on('SIGINT', () => stop(EXIT_CODES.INTERRUPTED));
  process.on('SIGTERM', () => stop(EXIT_CODES.TERMINATED));
}
