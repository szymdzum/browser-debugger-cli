/**
 * Shared utilities for follow/watch mode in commands.
 *
 * Provides a unified pattern for commands that continuously poll
 * and display updates (like tail -f behavior).
 */

import { genericError } from '@/errors/messages.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
 * - SIGINT handler for graceful shutdown
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
  refreshFn: () => Promise<void>,
  options: FollowModeOptions
): Promise<void> {
  const { startMessage, stopMessage, intervalMs = 1000 } = options;

  console.error(startMessage());
  await refreshFn();

  const intervalId = setInterval(() => {
    refreshFn().catch((error: unknown) => {
      console.error(genericError(getErrorMessage(error)));
    });
  }, intervalMs);

  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.error(stopMessage());
    process.exit(EXIT_CODES.SUCCESS);
  });
}
