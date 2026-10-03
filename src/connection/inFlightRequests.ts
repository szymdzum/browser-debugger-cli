/**
 * Track network requests in flight, keyed by requestId.
 *
 * A plain counter breaks on redirects (Chrome sends `requestWillBeSent` once
 * per hop but `loadingFinished` once per chain, so the count never returns to
 * zero) and on requests that started before tracking began (their completion
 * drives the count negative). A set of request ids has neither problem.
 */

import type { CDPConnection } from '@/connection/cdp.js';

interface RequestEvent {
  requestId: string;
}

/**
 * Live view of in-flight requests.
 */
export interface InFlightRequests {
  /** Number of requests currently in flight */
  readonly count: number;
  /** Distinct requests started since tracking began */
  readonly started: number;
  /** Timestamp (ms) of the last request start or completion */
  readonly lastActivity: number;
  /** Stop listening to CDP events */
  dispose: () => void;
}

/**
 * Start tracking in-flight requests on a CDP connection.
 *
 * The caller is responsible for `Network.enable`.
 *
 * @param cdp - CDP connection
 * @param onChange - Called after every start or completion
 * @returns Live tracker
 */
export function trackInFlightRequests(cdp: CDPConnection, onChange?: () => void): InFlightRequests {
  const inFlight = new Set<string>();
  const seen = new Set<string>();
  let lastActivity = Date.now();

  const onStarted = (params: RequestEvent): void => {
    inFlight.add(params.requestId);
    seen.add(params.requestId);
    lastActivity = Date.now();
    onChange?.();
  };
  const onFinished = (params: RequestEvent): void => {
    if (!inFlight.delete(params.requestId)) return;
    lastActivity = Date.now();
    onChange?.();
  };

  const cleanups = [
    cdp.on<RequestEvent>('Network.requestWillBeSent', onStarted),
    cdp.on<RequestEvent>('Network.loadingFinished', onFinished),
    cdp.on<RequestEvent>('Network.loadingFailed', onFinished),
  ];

  return {
    get count() {
      return inFlight.size;
    },
    get started() {
      return seen.size;
    },
    get lastActivity() {
      return lastActivity;
    },
    dispose: () => cleanups.forEach((cleanup) => cleanup()),
  };
}
