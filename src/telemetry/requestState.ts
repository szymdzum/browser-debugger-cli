/**
 * Lifecycle state of captured network requests.
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
 * Why a request failed, leaving out Chrome stopping an unneeded body after a
 * complete response (204/304 report `net::ERR_ABORTED` that way).
 *
 * @param request - Captured request
 * @returns Reason, or undefined when there is none worth showing
 */
export function failureReason(
  request: Pick<NetworkRequest, 'status' | 'errorText'>
): string | undefined {
  if (!request.errorText) return undefined;
  return getRequestState(request) === 'complete' && request.errorText === BODY_ABORTED
    ? undefined
    : request.errorText;
}

/**
 * Error Chrome reports when it stops reading a response body nobody needs
 * (the response itself arrived; not a failure of the request).
 */
export const BODY_ABORTED = 'net::ERR_ABORTED';
