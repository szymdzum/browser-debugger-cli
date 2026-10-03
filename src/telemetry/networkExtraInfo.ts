/**
 * Full request/response headers from CDP "ExtraInfo" events.
 *
 * `Network.requestWillBeSent` and `Network.responseReceived` omit headers the
 * browser adds or filters for the page — `Cookie` on requests, `Set-Cookie` on
 * responses. Chrome reports the raw headers separately in
 * `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo`, which may arrive
 * before or after the main events (and occasionally after the request
 * finished). This tracker buffers them and applies them to the right request.
 */

import type { NetworkRequest } from '@/types.js';

/** Recently finished requests kept for late ExtraInfo events. */
const MAX_RECENT_REQUESTS = 500;

interface PendingHeaders {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  /** HTTP status the buffered response headers belong to */
  responseStatus?: number;
}

/**
 * Whether a status is an HTTP redirect.
 *
 * @param status - HTTP status
 * @returns True for 3xx
 */
function isRedirect(status: number | undefined): boolean {
  return status !== undefined && status >= 300 && status < 400;
}

/**
 * Whether headers reported for `headerStatus` belong to a response with `responseStatus`.
 *
 * Redirect hops share the CDP requestId; headers of a 3xx response must not
 * land on the final response (or the other way round).
 *
 * @param headerStatus - Status reported with the ExtraInfo headers
 * @param responseStatus - Status of the response being updated
 * @returns True when they belong together
 */
function sameResponse(
  headerStatus: number | undefined,
  responseStatus: number | undefined
): boolean {
  if (headerStatus === undefined || responseStatus === undefined) return true;
  return isRedirect(headerStatus) === isRedirect(responseStatus);
}

/**
 * Matches ExtraInfo headers with captured requests.
 */
export class ExtraInfoTracker {
  private readonly pending = new Map<string, PendingHeaders>();
  private readonly recent = new Map<string, NetworkRequest>();

  /**
   * @param findActive - Look up an in-flight request by CDP requestId
   */
  constructor(private readonly findActive: (requestId: string) => NetworkRequest | undefined) {}

  /**
   * Record full request headers (including `Cookie`).
   *
   * @param requestId - CDP request id
   * @param headers - Raw request headers
   */
  onRequestExtraInfo(requestId: string, headers: Record<string, string>): void {
    const request = this.find(requestId);
    if (request) request.requestHeaders = headers;
    else this.buffer(requestId, { requestHeaders: headers });
  }

  /**
   * Record full response headers (including `Set-Cookie`).
   *
   * Applied immediately only when the request already has its response;
   * otherwise kept until `applyResponse`, so the regular response headers do
   * not overwrite them.
   *
   * @param requestId - CDP request id
   * @param headers - Raw response headers
   * @param statusCode - HTTP status the headers belong to
   */
  onResponseExtraInfo(
    requestId: string,
    headers: Record<string, string>,
    statusCode?: number
  ): void {
    const request = this.find(requestId);
    if (request?.status === undefined) {
      this.buffer(requestId, {
        responseHeaders: headers,
        ...(statusCode !== undefined && { responseStatus: statusCode }),
      });
    } else if (sameResponse(statusCode, request.status)) {
      request.responseHeaders = headers;
    }
  }

  /**
   * Apply buffered request headers to a newly created request.
   *
   * @param requestId - CDP request id
   * @param request - Request created from `requestWillBeSent`
   */
  applyRequest(requestId: string, request: NetworkRequest): void {
    const pending = this.pending.get(requestId);
    if (!pending?.requestHeaders) return;
    request.requestHeaders = pending.requestHeaders;
    this.clear(requestId, 'requestHeaders');
  }

  /**
   * Apply buffered response headers after a response (or redirect response)
   * was copied onto a request.
   *
   * @param requestId - CDP request id (a redirect hop has its own entry id)
   * @param request - Request whose response was just recorded
   */
  applyResponse(requestId: string, request: NetworkRequest): void {
    const pending = this.pending.get(requestId);
    if (!pending?.responseHeaders) return;
    if (sameResponse(pending.responseStatus, request.status)) {
      request.responseHeaders = pending.responseHeaders;
    }
    this.clear(requestId, 'responseHeaders');
  }

  /**
   * Remember a finished request so late ExtraInfo events still reach it.
   *
   * @param requestId - CDP request id
   * @param request - Finished request
   */
  complete(requestId: string, request: NetworkRequest): void {
    this.applyResponse(requestId, request);
    this.pending.delete(requestId);
    this.recent.delete(requestId);
    this.recent.set(requestId, request);
    if (this.recent.size > MAX_RECENT_REQUESTS) {
      const oldest = this.recent.keys().next().value;
      if (oldest !== undefined) this.recent.delete(oldest);
    }
  }

  /**
   * Find an in-flight or recently finished request.
   *
   * @param requestId - CDP request id
   * @returns Matching request, if any
   */
  private find(requestId: string): NetworkRequest | undefined {
    return this.findActive(requestId) ?? this.recent.get(requestId);
  }

  /**
   * Buffer headers until the matching request event arrives.
   *
   * @param requestId - CDP request id
   * @param headers - Headers to merge into the buffer
   */
  private buffer(requestId: string, headers: PendingHeaders): void {
    this.pending.set(requestId, { ...this.pending.get(requestId), ...headers });
    if (this.pending.size > MAX_RECENT_REQUESTS) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
  }

  /**
   * Drop one kind of buffered headers.
   *
   * @param requestId - CDP request id
   * @param key - Which headers were applied
   */
  private clear(requestId: string, key: keyof PendingHeaders): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    delete pending[key];
    if (key === 'responseHeaders') delete pending.responseStatus;
    if (!pending.requestHeaders && !pending.responseHeaders) this.pending.delete(requestId);
  }
}
