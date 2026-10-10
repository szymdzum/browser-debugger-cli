/**
 * Session-related user-facing messages.
 *
 * Centralized location for all session UI text including landing pages,
 * status displays, and session management messages.
 */

import type { PageLoadingState } from '@/ipc/protocol/commands.js';
import type { DialogInfo } from '@/ipc/protocol/domTypes.js';
import { joinLines } from '@/ui/formatting.js';
import { dialogResultText, pageLoadingWarning } from '@/ui/messages/commands.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Options for the landing page display.
 */
export interface LandingPageOptions {
  /** Target URL being monitored */
  url: string;
  /** HTTP status of the main document (a warning is shown for 4xx/5xx) */
  documentStatus?: number;
  /** The page had not finished loading (a warning names what it waits on) */
  loading?: PageLoadingState;
  /** When `--timeout` will stop the session */
  autoStopAt?: Date;
  /** Name of a named session (`--session`) */
  session?: string;
  /** JavaScript dialogs answered while the page loaded */
  dialogs?: DialogInfo[];
}

/**
 * Lines shown under the target in both the full and the quiet start output:
 * the session name, an HTTP error of the page, a page still loading, the
 * dialogs answered while it loaded, and when the session stops by itself.
 *
 * @param options - Landing page options
 * @returns Lines (empty when there is nothing to say)
 */
export function startNotices(options: LandingPageOptions): string[] {
  const { documentStatus, loading, autoStopAt, session, dialogs = [] } = options;
  return [
    ...(session
      ? [
          `Session: ${session} (pass --session ${session} or set BDG_SESSION=${session} on every command)`,
        ]
      : []),
    ...(documentStatus !== undefined && documentStatus >= 400
      ? [`⚠ The page responded with HTTP ${documentStatus}`]
      : []),
    ...(loading ? [`⚠ ${pageLoadingWarning(loading)}`] : []),
    ...dialogs.map(dialogResultText),
    ...(autoStopAt ? [`Auto-stop: at ${autoStopAt.toLocaleTimeString()} (--timeout)`] : []),
  ];
}

/** Most useful commands after a start, cheapest first (screenshots cost the most tokens) */
const START_NEXT_COMMANDS = [
  'bdg dom layout <selector>',
  'bdg dom query <selector>',
  'bdg dom form',
  'bdg peek',
  'bdg dom screenshot out.png',
];

/**
 * Generate the start output: the target, the notices of {@link startNotices},
 * one line of next commands and where to find the rest. Kept to a few lines
 * because agents read it on every start; `bdg --help` lists everything.
 *
 * @param options - Landing page options
 * @returns Formatted start output
 *
 * @example
 * ```typescript
 * landingPage({ url: 'http://localhost:3000' });
 * // Session Started
 * // Target: http://localhost:3000
 * // Next: bdg dom layout <selector>, bdg dom query <selector>, ...
 * // More: bdg --help (bdg --help --json for agents)
 * ```
 */
export function landingPage(options: LandingPageOptions): string {
  return joinLines(
    'Session Started',
    `Target: ${options.url}`,
    ...startNotices(options),
    `Next: ${START_NEXT_COMMANDS.join(', ')}`,
    'More: bdg --help (bdg --help --json for agents)'
  );
}

/**
 * Generate "session stopped" success message.
 *
 * @returns Formatted success message
 */
export function sessionStopped(): string {
  return 'Session stopped';
}

/**
 * Standard messages for stop command operations.
 */
export const STOP_MESSAGES = {
  SUCCESS: 'Session stopped successfully',
  FAILED: 'Failed to stop session',
} as const;

/**
 * Generate stop session failed error message.
 *
 * @param reason - Reason for failure
 * @returns Formatted error message
 */
export function stopFailedError(reason: string): string {
  return `Stop session failed: ${reason}`;
}

/**
 * Why the last session is gone, for `bdg status`.
 *
 * @param end - How and when it ended
 * @returns One line
 */
export function lastSessionEndText(end: { reason: string; endedAt: number }): string {
  return `The last session ended ${sessionEndText(end)}`;
}

/**
 * A session that ended without `bdg stop`, for `bdg sessions`.
 *
 * @param label - Session name as listed
 * @param end - How and when it ended
 * @returns One line
 */
export function endedSessionText(label: string, end: { reason: string; endedAt: number }): string {
  return `${label} ended ${sessionEndText(end)}`;
}

/**
 * A session whose directory is not safe to use, for `bdg sessions`.
 *
 * @param label - Session name as listed
 * @param why - Untrusted directory and why
 * @returns One line
 */
export function untrustedSessionText(label: string, why: string): string {
  return `${label}: ${why}`;
}

/**
 * When and why a session ended without `bdg stop`.
 *
 * @param end - How and when it ended
 * @returns `at <time>: <why>`
 */
function sessionEndText(end: { reason: string; endedAt: number }): string {
  const why: Record<string, string> = {
    crash: 'Chrome crashed or was closed',
    closed: 'its page was closed',
    timeout: 'the --timeout was reached',
  };
  const at = new Date(end.endedAt).toLocaleTimeString();
  return `at ${at}: ${why[end.reason] ?? end.reason}`;
}

/**
 * Note after a failed start or a stop whose daemon had not exited when bdg stopped waiting.
 *
 * @param pid - Daemon PID, when known
 * @param waitedMs - How long bdg waited
 * @returns Note
 */
export function daemonStillExitingHint(pid: number | undefined, waitedMs: number): string {
  const daemon = pid === undefined ? 'The daemon' : `The daemon (PID ${pid})`;
  return `${daemon} was still shutting down after ${waitedMs / 1000}s`;
}

/**
 * What to do about a daemon still shutting down after a failed start or a stop.
 *
 * @returns Suggestion
 */
export function daemonStillExitingSuggestion(): string {
  return `check with bdg sessions, or end it with ${sessionCommand('bdg cleanup --force')}`;
}
