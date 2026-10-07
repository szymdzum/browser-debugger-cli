/**
 * Human output of the network requests a DOM action triggered.
 */

import { MAX_TRIGGERED_REQUESTS } from '@/constants.js';
import type { TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import { assetTypeNames, isNotableRequest } from '@/telemetry/requestKinds.js';
import { formatRequestStatus } from '@/ui/formatters/requestStatus.js';
import { formatDuration, truncateUrl } from '@/ui/formatting.js';
import {
  assetRequestsNote,
  moreMatchesNote,
  moreRequestsNote,
  triggeredRequestsTitle,
} from '@/ui/messages/commands.js';

/** Requests listed in human output (JSON lists up to 50) */
export const MAX_TRIGGERED_REQUESTS_SHOWN = 10;

/** Longest URL shown before it is shortened */
const URL_MAX_LENGTH = 60;

/**
 * Title of the list, with how many requests there were in all (the listed
 * rows, the "... and N more" note and the assets line add up to it).
 *
 * @param requests - Triggered requests in the result
 * @param omitted - Requests the result left out
 * @returns e.g. "Requests during the action (18):"
 */
export function formatTriggeredRequestsTitle(requests: TriggeredRequest[], omitted = 0): string {
  return triggeredRequestsTitle(requests.length + omitted);
}

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
 * Lines listing the triggered requests: the first
 * {@link MAX_TRIGGERED_REQUESTS_SHOWN} notable ones (documents, XHR, fetch,
 * WebSocket, failures; see {@link isNotableRequest}), how many more there
 * are and where to find them (JSON, or the network list when JSON left some
 * out too), then one line counting the static assets that loaded.
 *
 * @param requests - Triggered requests, in start order
 * @param omitted - Requests the result already left out
 * @returns Lines (empty when there are none)
 */
export function formatTriggeredRequestLines(requests: TriggeredRequest[], omitted = 0): string[] {
  const notable = requests.filter(isNotableRequest);
  const assets = requests.filter((request) => !isNotableRequest(request));
  const lines = notable.slice(0, MAX_TRIGGERED_REQUESTS_SHOWN).map(formatTriggeredRequest);
  const hidden = notable.length - lines.length + omitted;
  if (hidden > 0)
    lines.push(
      omitted > 0 ? moreRequestsNote(hidden) : moreMatchesNote(hidden, MAX_TRIGGERED_REQUESTS)
    );
  if (assets.length > 0) lines.push(assetRequestsNote(assets.length, assetTypeNames(assets)));
  return lines;
}
