/**
 * Shared status labels for network requests.
 *
 * A request is pending until it completes or fails. Status 0 means it failed
 * without any response (DNS, refused, aborted, blocked); a request that got a
 * response keeps its HTTP status even if loading failed afterwards.
 */

import type { NetworkRequest } from '@/types.js';

/** Lifecycle state of a captured request. */
export type RequestState = 'pending' | 'failed' | 'complete';

/**
 * Classify a request.
 *
 * @param request - Captured request
 * @returns Its lifecycle state
 */
export function getRequestState(request: Pick<NetworkRequest, 'status'>): RequestState {
  if (request.status === undefined) return 'pending';
  return request.status === 0 ? 'failed' : 'complete';
}

/**
 * Human-readable status: the HTTP status (with the failure reason if loading
 * failed after the response), `FAILED (<reason>)`, or `pending`.
 *
 * @param request - Captured request
 * @returns Status label
 */
export function formatRequestStatus(request: Pick<NetworkRequest, 'status' | 'errorText'>): string {
  const state = getRequestState(request);
  if (state === 'pending') return 'pending';
  if (state === 'failed') return `FAILED (${request.errorText ?? 'no response'})`;
  return request.errorText ? `${request.status} (${request.errorText})` : String(request.status);
}
