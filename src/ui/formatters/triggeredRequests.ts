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
 * Status of a request as shown in a row, e.g. `200`, `FAILED (net::ERR_ABORTED)`.
 *
 * @param request - Triggered request
 * @returns Status text
 */
function requestStatusText(request: TriggeredRequest): string {
  const httpStatus = request.failed ? 0 : request.status;
  return formatRequestStatus({
    ...(httpStatus !== undefined && { status: httpStatus }),
    ...(request.errorText !== undefined && { errorText: request.errorText }),
  });
}

/**
 * One request as a line, e.g. `POST 127.0.0.1:8080/api/save → 200 (85ms)`,
 * or `GET 127.0.0.1:8080/events → 200 (loading)` while its body still loads.
 *
 * @param request - Triggered request
 * @returns Line text
 */
export function formatTriggeredRequest(request: TriggeredRequest): string {
  const status = requestStatusText(request);
  const duration = request.loading
    ? ' (loading)'
    : request.durationMs === undefined
      ? ''
      : ` (${formatDuration(request.durationMs)})`;
  return `${request.method} ${truncateUrl(request.url, URL_MAX_LENGTH)} → ${status}${duration}`;
}

/**
 * Requests with the same method, scheme, host and path (query and fragment
 * ignored), at the position of the first of them.
 *
 * @param requests - Triggered requests, in start order
 * @returns Groups of one or more requests
 */
function groupRepeatedRequests(
  requests: TriggeredRequest[]
): Array<[TriggeredRequest, ...TriggeredRequest[]]> {
  const groups = new Map<string, [TriggeredRequest, ...TriggeredRequest[]]>();
  for (const request of requests) {
    const key = `${request.method} ${request.url.split(/[?#]/, 1)[0]}`;
    const group = groups.get(key);
    if (group) group.push(request);
    else groups.set(key, [request]);
  }
  return [...groups.values()];
}

/**
 * A group of requests as one line: `POST 127.0.0.1:8080/event ×8 → 501` when
 * they share a status, `POST 127.0.0.1:8080/event → 200 ×6, 501 ×2` when they
 * differ (counts in the order the statuses first appeared). A single request
 * is a line of its own, with its duration.
 *
 * @param group - Requests with the same method and path
 * @returns Line text
 */
function formatRequestGroup(group: [TriggeredRequest, ...TriggeredRequest[]]): string {
  const [first] = group;
  if (group.length === 1) return formatTriggeredRequest(first);
  const counts = new Map<string, number>();
  for (const request of group) {
    const status = requestStatusText(request);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const target = truncateUrl(first.url.split(/[?#]/, 1)[0] ?? first.url, URL_MAX_LENGTH);
  if (counts.size === 1)
    return `${first.method} ${target} ×${group.length} → ${[...counts.keys()][0]}`;
  const statuses = [...counts].map(([status, count]) => `${status} ×${count}`).join(', ');
  return `${first.method} ${target} → ${statuses}`;
}

/**
 * Lines listing the triggered requests: the first
 * {@link MAX_TRIGGERED_REQUESTS_SHOWN} rows of notable requests (documents,
 * XHR, fetch, WebSocket, failures; see {@link isNotableRequest}), requests
 * with one method and path (query ignored) sharing a row, how many more there
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
  const shown = groupRepeatedRequests(notable).slice(0, MAX_TRIGGERED_REQUESTS_SHOWN);
  const lines = shown.map(formatRequestGroup);
  const hidden = notable.length - shown.flat().length + omitted;
  if (hidden > 0)
    lines.push(
      omitted > 0 ? moreRequestsNote(hidden) : moreMatchesNote(hidden, MAX_TRIGGERED_REQUESTS)
    );
  if (assets.length > 0) lines.push(assetRequestsNote(assets.length, assetTypeNames(assets)));
  return lines;
}
