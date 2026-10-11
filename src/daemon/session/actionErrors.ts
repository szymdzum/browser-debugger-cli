/**
 * Console errors and uncaught exceptions an interaction caused, read from the
 * session's console telemetry (no CDP listeners of its own, no waiting).
 */

import type { TelemetryStore } from './TelemetryStore.js';

import type { ActionError } from '@/ipc/protocol/domTypes.js';
import { cutText } from '@/runtime/dom/actionEffects.js';
import { shouldExcludeDomain } from '@/telemetry/filters.js';
import { extractHostname } from '@/utils/url.js';
import type { ConsoleMessage } from '@/types.js';
import { LEVEL_MAP, analyzeMessages, formatFramePosition } from '@/ui/formatters/console/shared.js';

/** Distinct errors reported per action */
const MAX_ACTION_ERRORS = 3;

/** Errors logged since the watch began: the first distinct ones, and how many more there were */
export interface CollectedErrors {
  errors?: ActionError[];
  moreErrors?: number;
  hiddenTrackerErrors?: number;
}

/** Lists the errors logged since the watch began */
export type ActionErrorsCollector = () => CollectedErrors;

/**
 * Start attributing console errors to an interaction.
 *
 * Errors are attributed by when bdg received them, like triggered requests:
 * every message of the error level (`console.error`, failed
 * `console.assert`, uncaught exceptions, unhandled rejections, browser errors
 * such as failed loads) from the page, its iframes and workers that arrived
 * after this call belongs to the interaction, also one logged by a page
 * timer meanwhile or by the page an action navigated to. Arrival order is
 * bdg's own, not Chrome's timestamps, so a Chrome whose clock differs (a
 * remote one) changes nothing; a message received earlier but added late
 * (its objects expanded after the action began) is left out. Messages are grouped like `bdg console` groups
 * them (same text and source location), in order of first appearance.
 * Errors whose first stack frame is a script on a host the default tracking
 * filter drops ({@link fromTracker}) are left out and only counted, unless
 * the session runs with `--all`; stackless entries (a tracker's
 * `Failed to load resource`) are still listed.
 * Nothing is reported when console telemetry is off.
 *
 * @param store - Session store holding the console telemetry
 * @returns Collector (at most {@link MAX_ACTION_ERRORS} distinct errors, plus
 *   how many more there were); empty when no error was logged
 */
export function watchActionErrors(store: TelemetryStore): ActionErrorsCollector {
  const mark = store.consoleMessagesReceived();
  return () => {
    const logged = store.consoleMessages.filter(
      (message) => LEVEL_MAP[message.type] === 'error' && store.receivedAfter(message, mark)
    );
    const pageUrl = store.navigationEvents.at(-1)?.url;
    const own = logged.filter((message) => !fromTracker(message, store.includeAll, pageUrl));
    const hidden = logged.length - own.length;
    const hiddenField = hidden > 0 ? { hiddenTrackerErrors: hidden } : {};
    const groups = analyzeMessages(own).grouped.errors;
    if (groups.length === 0) return hiddenField;
    const errors = groups
      .slice(0, MAX_ACTION_ERRORS)
      .map(({ message, count }) => toActionError(message, count));
    const more = groups.length - errors.length;
    return { errors, ...(more > 0 && { moreErrors: more }), ...hiddenField };
  };
}

/**
 * Whether a console error came from a tracker: the URL of its first stack
 * frame is on a host the tracking filter drops, and that host is not the
 * page's own site (a dashboard on sentry.io or facebook.com keeps its
 * errors). Same site means the last two labels of the hosts match (a simple
 * registrable-domain check: `app.example.co.uk` and `cdn.other.co.uk` count
 * as the same site). Messages without a stack trace are never left out.
 *
 * @param message - Console message
 * @param includeAll - The session runs without the tracking filters
 * @param pageUrl - URL of the session's page, when known
 * @returns True to leave it out of the action's errors
 */
export function fromTracker(
  message: ConsoleMessage,
  includeAll: boolean,
  pageUrl: string | undefined
): boolean {
  const url = message.stackTrace?.[0]?.url;
  if (url === undefined || url === '' || !shouldExcludeDomain(url, includeAll)) return false;
  return pageUrl === undefined || siteOf(url) !== siteOf(pageUrl);
}

/**
 * A URL's site for {@link fromTracker}: the last two labels of its host.
 *
 * @param url - URL
 * @returns e.g. `sentry.io` for `https://my.sentry.io/x`
 */
function siteOf(url: string): string {
  return extractHostname(url).toLowerCase().split('.').slice(-2).join('.');
}

/**
 * An error as an action reports it: its text on one line, cut to 120
 * characters, and where it came from.
 *
 * @param message - First message of the group
 * @param count - Messages in the group
 * @returns Reported error
 */
function toActionError(message: ConsoleMessage, count: number): ActionError {
  const frame = message.stackTrace?.[0];
  return {
    text: cutText(message.text.replace(/\s+/g, ' ').trim()),
    ...(frame && { source: formatFramePosition(frame) }),
    count,
  };
}
