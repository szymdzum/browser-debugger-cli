/**
 * Network requests an interaction triggered, read from the session's network
 * telemetry (no CDP listeners of its own).
 */

import type { TelemetryStore } from './TelemetryStore.js';

import { MAX_TRIGGERED_REQUESTS } from '@/constants.js';
import type { TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import { isNotableRequest } from '@/telemetry/requestKinds.js';
import { failureReason, getRequestState } from '@/telemetry/requestState.js';
import type { NetworkRequest, WebSocketConnection } from '@/types.js';

/** URLs that never reach the network (inline data, in-page objects) */
const LOCAL_URL_PATTERN = /^(data|blob):/i;

/** Requests started since the watch began: the first ones, and how many more there were */
export interface CollectedRequests {
  triggeredRequests: TriggeredRequest[];
  triggeredRequestsOmitted?: number;
}

/** A request seen starting, and whether it was still in flight */
interface StartedRequest {
  request: NetworkRequest;
  inFlight?: boolean;
}

/** Lists the requests started since the watch began */
export type TriggeredRequestsCollector = () => CollectedRequests | undefined;

/**
 * Start attributing requests to an interaction.
 *
 * Requests are attributed by time: every request (and WebSocket connection)
 * bdg saw start between this call and the collector's call belongs to the
 * interaction, including one a page timer or poller happened to start
 * meanwhile. Collecting adds no wait: requests
 * still running then are reported as pending.
 *
 * @param store - Session store holding the network telemetry
 * @returns Collector (at most {@link MAX_TRIGGERED_REQUESTS} requests, plus how
 *   many more there were); it returns undefined when network telemetry is off
 */
export function watchTriggeredRequests(store: TelemetryStore): TriggeredRequestsCollector {
  if (!store.activeTelemetry.includes('network')) return () => undefined;
  const startedAt = Date.now();
  const firstFinished = requestsFinished(store);
  const firstWebSocket = store.websocketConnections.length;
  return () => {
    const firstKept = Math.max(0, firstFinished - store.networkEvictions.requestsDropped);
    const started: StartedRequest[] = [
      ...store.networkRequests.slice(firstKept).map((request) => ({ request })),
      ...[...store.pendingNetworkRequests.values()].map((pending) => ({
        request: pending.request,
        inFlight: true,
      })),
      ...store.websocketConnections
        .slice(firstWebSocket)
        .map((connection) => ({ request: webSocketAsRequest(connection) })),
    ]
      .filter(({ request }) => request.timestamp >= startedAt && isReportable(request))
      .sort((a, b) => byStartTime(a.request, b.request));
    const triggered = started.map(({ request, inFlight }) => toTriggeredRequest(request, inFlight));
    const kept = keepNotableFirst(triggered, MAX_TRIGGERED_REQUESTS);
    const omitted = triggered.length - kept.length;
    return {
      triggeredRequests: kept,
      ...(omitted > 0 && { triggeredRequestsOmitted: omitted }),
    };
  };
}

/**
 * Requests the session has finished, dropped ones included.
 *
 * @param store - Session store
 * @returns Count that only grows
 */
function requestsFinished(store: TelemetryStore): number {
  return store.networkEvictions.requestsDropped + store.networkRequests.length;
}

/**
 * At most `limit` requests, notable ones first (pages, API calls, sockets,
 * failures), then assets, still in start order.
 *
 * @param requests - Requests in start order
 * @param limit - How many to keep
 * @returns Kept requests, in start order
 */
export function keepNotableFirst(requests: TriggeredRequest[], limit: number): TriggeredRequest[] {
  if (requests.length <= limit) return requests;
  const notable = requests.filter(isNotableRequest).slice(0, limit);
  const assets = requests
    .filter((request) => !isNotableRequest(request))
    .slice(0, limit - notable.length);
  const kept = new Set([...notable, ...assets]);
  return requests.filter((request) => kept.has(request));
}

/**
 * Count a submission's network requests as its request list does (the
 * submit watcher counts every request id CDP reported until the wait ended:
 * `data:` URLs and preflights included, a redirect chain once), so
 * `networkRequests`, the listed requests and JSON agree. Without network
 * telemetry the watcher's count stays.
 *
 * @param result - Submit result with the requests it triggered
 * @returns The result, `networkRequests` matching `triggeredRequests`
 */
export function withTriggeredRequestCount<
  T extends {
    networkRequests?: number | undefined;
    triggeredRequests?: TriggeredRequest[] | undefined;
    triggeredRequestsOmitted?: number | undefined;
  },
>(result: T): T {
  if (result.networkRequests === undefined || result.triggeredRequests === undefined) return result;
  const total = result.triggeredRequests.length + (result.triggeredRequestsOmitted ?? 0);
  return { ...result, networkRequests: total };
}

/**
 * A WebSocket connection as a request: its handshake (`GET ws://…`, 101 once
 * it opened, failed when it closed without one).
 *
 * @param connection - Captured WebSocket connection
 * @returns Request-shaped view of the handshake
 */
function webSocketAsRequest(connection: WebSocketConnection): NetworkRequest {
  const failed = connection.status === undefined && connection.closedTime !== undefined;
  return {
    requestId: connection.requestId,
    url: connection.url,
    method: 'GET',
    timestamp: connection.timestamp,
    resourceType: 'WebSocket',
    ...(connection.status !== undefined && { status: connection.status }),
    ...(failed && { status: 0 }),
    ...(failed && connection.errorMessage !== undefined && { errorText: connection.errorMessage }),
  };
}

/**
 * Order requests by when they started: Chrome's start time when both have
 * one (bdg's own receipt times are whole milliseconds, so requests started
 * together tie), otherwise when bdg saw them start.
 *
 * @param a - Request
 * @param b - Request
 * @returns Sort order
 */
function byStartTime(a: NetworkRequest, b: NetworkRequest): number {
  if (a.sentTime !== undefined && b.sentTime !== undefined) return a.sentTime - b.sentTime;
  return a.timestamp - b.timestamp;
}

/**
 * Whether a request is worth reporting: not a local URL and not a CORS
 * preflight (Chrome reports those beside the request they guard).
 *
 * @param request - Captured request
 * @returns True to report it
 */
function isReportable(request: NetworkRequest): boolean {
  return request.resourceType !== 'Preflight' && !LOCAL_URL_PATTERN.test(request.url);
}

/**
 * Summarize a captured request.
 *
 * @param request - Captured request
 * @param inFlight - Whether it was still in flight (a request with a response
 *   is then still loading its body: a stream, a slow download)
 * @returns Triggered request entry
 */
export function toTriggeredRequest(request: NetworkRequest, inFlight = false): TriggeredRequest {
  const state = getRequestState(request);
  const errorText = failureReason(request);
  return {
    requestId: request.requestId,
    method: request.method,
    url: request.url,
    ...(request.resourceType !== undefined && { resourceType: request.resourceType }),
    ...(state === 'complete' && { status: request.status }),
    ...(state === 'complete' && inFlight && { loading: true as const }),
    ...(state !== 'pending' && request.duration !== undefined && { durationMs: request.duration }),
    ...(state === 'failed' && { failed: true as const }),
    ...(errorText !== undefined && { errorText }),
    ...(state === 'pending' && { pending: true as const }),
  };
}
