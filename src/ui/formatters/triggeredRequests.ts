/**
 * Human output of the network requests a DOM action triggered.
 */

import type { TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import { formatRequestStatus } from '@/ui/formatters/requestStatus.js';
import { formatDuration, truncateUrl } from '@/ui/formatting.js';
import { moreMatchesNote, moreRequestsNote } from '@/ui/messages/commands.js';

/** Requests listed in human output (JSON lists up to 50) */
export const MAX_TRIGGERED_REQUESTS_SHOWN = 10;

/** Longest URL shown before it is shortened */
const URL_MAX_LENGTH = 60;

/**
 * Title of the list (requests are attributed by time, so a page poller's
 * requests are listed too: the title doesn't claim the action caused them)
 */
export const TRIGGERED_REQUESTS_TITLE = 'Requests during the action:';

/**
 * One request as a line, e.g. `POST 127.0.0.1:8080/api/save → 200 (85ms)`,
 * or `GET 127.0.0.1:8080/events → 200 (loading)` while its body still loads.
 *
 * @param request - Triggered request
 * @returns Line text
 */
export function formatTriggeredRequest(request: TriggeredRequest): string {
  const httpStatus = request.failed ? 0 : request.status;
  const status = formatRequestStatus({
    ...(httpStatus !== undefined && { status: httpStatus }),
    ...(request.errorText !== undefined && { errorText: request.errorText }),
  });
  const duration = request.loading
    ? ' (loading)'
    : request.durationMs === undefined
      ? ''
      : ` (${formatDuration(request.durationMs)})`;
  return `${request.method} ${truncateUrl(request.url, URL_MAX_LENGTH)} → ${status}${duration}`;
}

/**
 * Lines listing the triggered requests, the first
 * {@link MAX_TRIGGERED_REQUESTS_SHOWN} of them followed by how many more there
 * are, and where to find them (JSON, or the network list when JSON left some
 * out too).
 *
 * @param requests - Triggered requests, in start order
 * @param omitted - Requests the result already left out
 * @returns Lines (empty when there are none)
 */
export function formatTriggeredRequestLines(requests: TriggeredRequest[], omitted = 0): string[] {
  const lines = requests.slice(0, MAX_TRIGGERED_REQUESTS_SHOWN).map(formatTriggeredRequest);
  const hidden = requests.length - lines.length + omitted;
  if (hidden <= 0) return lines;
  return [...lines, omitted > 0 ? moreRequestsNote(hidden) : moreMatchesNote(hidden)];
}
