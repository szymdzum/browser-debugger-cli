/**
 * Network requests an interaction triggered, read from the session's network
 * telemetry (no CDP listeners of its own).
 */

import type { TelemetryStore } from './TelemetryStore.js';

import type { TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import type { NetworkRequest } from '@/types.js';
import { failureReason, getRequestState } from '@/telemetry/requestState.js';

/** URLs that never reach the network (inline data, in-page objects) */
const LOCAL_URL_PATTERN = /^(data|blob):/i;

/** Requests listed in a result (a click that loads a page triggers its whole load) */
export const MAX_TRIGGERED_REQUESTS = 50;

/** Requests started since the watch began: the first ones, and how many more there were */
export interface CollectedRequests {
  triggeredRequests: TriggeredRequest[];
  triggeredRequestsOmitted?: number;
}

/** Lists the requests started since the watch began */
export type TriggeredRequestsCollector = () => CollectedRequests | undefined;

/**
 * Start attributing requests to an interaction.
 *
 * Requests are attributed by time: every request bdg saw start between this
 * call and the collector's call belongs to the interaction, including one a
 * page timer happened to start meanwhile. Collecting adds no wait: requests
 * still running then are reported as pending.
 *
 * @param store - Session store holding the network telemetry
 * @returns Collector (at most {@link MAX_TRIGGERED_REQUESTS} requests, plus how
 *   many more there were); it returns undefined when network telemetry is off
 */
export function watchTriggeredRequests(store: TelemetryStore): TriggeredRequestsCollector {
  if (!store.activeTelemetry.includes('network')) return () => undefined;
  const startedAt = Date.now();
  const firstFinished = store.networkRequests.length;
  return () => {
    const started = [
      ...store.networkRequests.slice(firstFinished),
      ...[...store.pendingNetworkRequests.values()].map((pending) => pending.request),
    ]
      .filter((request) => request.timestamp >= startedAt && isReportable(request))
      .sort(byStartTime);
    const omitted = started.length - MAX_TRIGGERED_REQUESTS;
    return {
      triggeredRequests: started.slice(0, MAX_TRIGGERED_REQUESTS).map(toTriggeredRequest),
      ...(omitted > 0 && { triggeredRequestsOmitted: omitted }),
    };
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
 * @returns Triggered request entry
 */
export function toTriggeredRequest(request: NetworkRequest): TriggeredRequest {
  const state = getRequestState(request);
  const errorText = failureReason(request);
  return {
    requestId: request.requestId,
    method: request.method,
    url: request.url,
    ...(state === 'complete' && { status: request.status }),
    ...(state !== 'pending' && request.duration !== undefined && { durationMs: request.duration }),
    ...(state === 'failed' && { failed: true as const }),
    ...(errorText !== undefined && { errorText }),
    ...(state === 'pending' && { pending: true as const }),
  };
}
