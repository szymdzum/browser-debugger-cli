/**
 * Shared utilities for handling daemon connection errors in commands.
 */

import { sessionUnavailableSuggestion } from '@/errors/messages.js';
import { genericError } from '@/errors/messages.js';
import { OutputBuilder } from '@/ui/OutputBuilder.js';
import {
  connectionLostRetryMessage,
  connectionLostStopHintMessage,
  followedSessionEndedMessage,
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
 * answered exits too (there is nothing to follow, exit 83), and so does one
 * that ends while followed (no session any more, exit 83), so a follower
 * running in the background finds out. Other failures (a busy page, a
 * timeout) are retried: reported once in text, and on every failed refresh
 * in JSON, one object per line.
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
  const sessionGone = exitCode === EXIT_CODES.RESOURCE_NOT_FOUND;
  const exits = !follow || !followState.connected || sessionGone;
  const message =
    follow && followState.connected && sessionGone ? followedSessionEndedMessage() : error;

  if (exits || json || !followState.lossReported) {
    if (json) {
      const suggestion = exits ? sessionUnavailableSuggestion(exitCode) : undefined;
      const envelope = OutputBuilder.buildJsonError(message, {
        exitCode,
        ...(suggestion && { suggestion }),
      });
      console.log(follow ? JSON.stringify(envelope) : JSON.stringify(envelope, null, 2));
    } else {
      console.error(genericError(message));
    }
  }
  if (exits) return { shouldExit: true, exitCode };

  if (!followState.lossReported) {
    const retryMessage =
      retryIntervalMs >= 1000 ? `${retryIntervalMs / 1000}s` : `${retryIntervalMs}ms`;
    if (!json) {
      console.error(connectionLostRetryMessage(new Date().toISOString(), retryMessage));
      console.error(connectionLostStopHintMessage());
    }
    followState.lossReported = true;
  }
  return { shouldExit: false };
}
