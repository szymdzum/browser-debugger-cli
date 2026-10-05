/**
 * Shared status labels for network requests.
 *
 * A request is pending until it completes or fails. Status 0 means it failed
 * without any response (DNS, refused, aborted, blocked); a request that got a
 * response keeps its HTTP status even if loading failed afterwards.
 */

import { BODY_ABORTED, getRequestState } from '@/telemetry/requestState.js';
import type { NetworkRequest } from '@/types.js';

export { failureReason, getRequestState, type RequestState } from '@/telemetry/requestState.js';

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
  return request.errorText && request.errorText !== BODY_ABORTED
    ? `${request.status} (${request.errorText})`
    : String(request.status);
}
