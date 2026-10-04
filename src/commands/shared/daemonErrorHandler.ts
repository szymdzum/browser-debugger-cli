/**
 * Shared utilities for handling daemon connection errors in commands.
 */

import { sessionUnavailableSuggestion } from '@/errors/messages.js';
import { genericError } from '@/errors/messages.js';
import { OutputBuilder } from '@/ui/OutputBuilder.js';
import {
  connectionLostRetryMessage,
  connectionLostStopHintMessage,
} from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Options for daemon connection error handling. */
export interface DaemonErrorOptions {
  /** Use JSON output format */
  json?: boolean | undefined;
  /** Follow/watch mode (don't exit, show retry message) */
  follow?: boolean | undefined;
  /** Retry interval in milliseconds (for display message) */
  retryIntervalMs?: number | undefined;
  /** Custom exit code (defaults to RESOURCE_NOT_FOUND) */
  exitCode?: number | undefined;
}

/** Result of handling a daemon connection error. */
export interface DaemonErrorResult {
  /** Whether the process should exit */
  shouldExit: boolean;
  /** Exit code to use if exiting */
  exitCode?: number;
}

/** Follow-mode state: whether a session ever answered, and whether its loss was reported */
const followState = { connected: false, lossReported: false };

/**
 * Record that a follow-mode refresh reached the session, so a later loss is
 * reported (once) and retried, not treated as "no session to follow".
 */
export function noteFollowConnected(): void {
  followState.connected = true;
  followState.lossReported = false;
}

/**
 * Handle daemon connection errors with consistent formatting and behavior.
 *
 * Outside follow mode the command exits. In follow mode, a session that never
 * answered exits too (there is nothing to follow, exit 83); a session that
 * goes away is reported once and retried until a new one starts.
 *
 * @param error - Error message to display
 * @param options - Error handling options
 * @returns Result indicating whether to exit
 */
export function handleDaemonConnectionError(
  error: string,
  options: DaemonErrorOptions
): DaemonErrorResult {
  const {
    json = false,
    follow = false,
    retryIntervalMs = 1000,
    exitCode = EXIT_CODES.RESOURCE_NOT_FOUND,
  } = options;
  const exits = !follow || !followState.connected;

  if (exits || !followState.lossReported) {
    if (json) {
      const suggestion = exits ? sessionUnavailableSuggestion(exitCode) : undefined;
      console.log(
        JSON.stringify(
          OutputBuilder.buildJsonError(error, { exitCode, ...(suggestion && { suggestion }) }),
          null,
          2
        )
      );
    } else {
      console.error(genericError(error));
    }
  }
  if (exits) return { shouldExit: true, exitCode };

  if (!followState.lossReported) {
    const retryMessage =
      retryIntervalMs >= 1000 ? `${retryIntervalMs / 1000}s` : `${retryIntervalMs}ms`;
    console.error(connectionLostRetryMessage(new Date().toISOString(), retryMessage));
    console.error(connectionLostStopHintMessage());
    followState.lossReported = true;
  }
  return { shouldExit: false };
}
