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
 * A header's value, whatever the case of its name.
 *
 * @param headers - Headers
 * @param name - Lower-case header name
 * @returns The value, if present
 */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/**
 * Whether a completed redirect hop went to a `Location` (relative to the hop).
 *
 * @param hop - Completed hop, with the URL it redirected to
 * @param location - `Location` header value
 * @returns True if they match
 */
function redirectsTo(hop: NetworkRequest, location: string): boolean {
  try {
    return hop.redirectURL === new URL(location, hop.url).href;
  } catch {
    return false;
  }
}

/**
 * Matches ExtraInfo headers with captured requests.
 */
export class ExtraInfoTracker {
  private readonly pending = new Map<string, PendingHeaders>();
  private readonly recent = new Map<string, NetworkRequest>();
  /** Completed redirect hops per request id (their headers can arrive late) */
  private readonly redirectHops = new Map<string, NetworkRequest[]>();

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
    if (this.applyToRedirectHop(requestId, headers, statusCode)) return;
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
   * Remember a completed redirect hop: the headers of its 3xx response
   * (with Set-Cookie) may arrive after the next hop has started.
   *
   * @param requestId - CDP request id shared by all hops
   * @param hop - The completed hop
   */
  recordRedirectHop(requestId: string, hop: NetworkRequest): void {
    const hops = this.redirectHops.get(requestId) ?? [];
    this.redirectHops.delete(requestId);
    this.redirectHops.set(requestId, [...hops, hop]);
    if (this.redirectHops.size > MAX_RECENT_REQUESTS) {
      const oldest = this.redirectHops.keys().next().value;
      if (oldest !== undefined) this.redirectHops.delete(oldest);
    }
  }

  /**
   * Give raw response headers to the completed redirect hop they belong to:
   * the hop with that status whose target is the headers' `Location`.
   *
   * @param requestId - CDP request id
   * @param headers - Raw response headers
   * @param statusCode - Status the headers belong to
   * @returns True if a completed hop took the headers
   */
  private applyToRedirectHop(
    requestId: string,
    headers: Record<string, string>,
    statusCode: number | undefined
  ): boolean {
    const location = headerValue(headers, 'location');
    if (!isRedirect(statusCode) || !location) return false;
    const hop = this.redirectHops
      .get(requestId)
      ?.find((candidate) => candidate.status === statusCode && redirectsTo(candidate, location));
    if (!hop) return false;
    hop.responseHeaders = headers;
    return true;
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
    this.redirectHops.delete(requestId);
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
