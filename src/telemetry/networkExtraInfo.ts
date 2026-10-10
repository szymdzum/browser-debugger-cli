/**
 * Full request/response headers from CDP "ExtraInfo" events.
 *
 * `Network.requestWillBeSent` and `Network.responseReceived` omit headers the
 * browser adds or filters for the page — `Cookie` on requests, `Set-Cookie` on
 * responses. Chrome reports the raw headers separately in
 * `requestWillBeSentExtraInfo` / `responseReceivedExtraInfo`, which may arrive
 * before or after the main events (and occasionally after the request
 * finished). This tracker buffers them and applies them to the right request,
 * with the cookies Chrome blocked on it (blockedCookies.ts), which travel
 * with the headers of the same event.
 */

import { addBlockedCookies } from '@/telemetry/blockedCookies.js';
import type { BlockedCookie, NetworkRequest } from '@/types.js';

/** Recently finished requests kept for late ExtraInfo events. */
const MAX_RECENT_REQUESTS = 500;

interface PendingHeaders {
  requestHeaders?: Record<string, string>;
  /** Cookies not sent, from the event of the buffered request headers */
  requestBlockedCookies?: BlockedCookie[];
  responseHeaders?: Record<string, string>;
  /** Set-Cookies rejected, from the event of the buffered response headers */
  responseBlockedCookies?: BlockedCookie[];
  /** HTTP status the buffered response headers belong to */
  responseStatus?: number;
}

/**
 * Give a request its full request headers and the cookies not sent with it.
 *
 * @param request - Request to update
 * @param headers - Raw request headers
 * @param blocked - Cookies not sent
 */
function setRequestInfo(
  request: NetworkRequest,
  headers: Record<string, string>,
  blocked: BlockedCookie[] = []
): void {
  request.requestHeaders = headers;
  addBlockedCookies(request, blocked);
}

/**
 * Give a request its full response headers and the Set-Cookies rejected.
 *
 * @param request - Request (or redirect hop) to update
 * @param headers - Raw response headers
 * @param blocked - Set-Cookies rejected
 */
function setResponseInfo(
  request: NetworkRequest,
  headers: Record<string, string>,
  blocked: BlockedCookie[] = []
): void {
  request.responseHeaders = headers;
  addBlockedCookies(request, blocked);
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
   * Record full request headers (including `Cookie`) and the cookies not sent.
   *
   * @param requestId - CDP request id
   * @param headers - Raw request headers
   * @param blocked - Cookies Chrome left out of the request
   */
  onRequestExtraInfo(
    requestId: string,
    headers: Record<string, string>,
    blocked: BlockedCookie[] = []
  ): void {
    const request = this.find(requestId);
    if (request) setRequestInfo(request, headers, blocked);
    else this.buffer(requestId, { requestHeaders: headers, requestBlockedCookies: blocked });
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
   * @param blocked - Set-Cookies of the response Chrome rejected
   */
  onResponseExtraInfo(
    requestId: string,
    headers: Record<string, string>,
    statusCode?: number,
    blocked: BlockedCookie[] = []
  ): void {
    if (this.applyToRedirectHop(requestId, headers, statusCode, blocked)) return;
    const request = this.find(requestId);
    if (request?.status === undefined) {
      this.buffer(requestId, {
        responseHeaders: headers,
        responseBlockedCookies: blocked,
        ...(statusCode !== undefined && { responseStatus: statusCode }),
      });
    } else if (sameResponse(statusCode, request.status)) {
      setResponseInfo(request, headers, blocked);
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
    setRequestInfo(request, pending.requestHeaders, pending.requestBlockedCookies);
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
      setResponseInfo(request, pending.responseHeaders, pending.responseBlockedCookies);
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
   * @param blocked - Set-Cookies of the response Chrome rejected
   * @returns True if a completed hop took the headers
   */
  private applyToRedirectHop(
    requestId: string,
    headers: Record<string, string>,
    statusCode: number | undefined,
    blocked: BlockedCookie[]
  ): boolean {
    const location = headerValue(headers, 'location');
    if (!isRedirect(statusCode) || !location) return false;
    const hop = this.redirectHops
      .get(requestId)
      ?.find((candidate) => candidate.status === statusCode && redirectsTo(candidate, location));
    if (!hop) return false;
    setResponseInfo(hop, headers, blocked);
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
   * @param key - Which headers were applied (their status and blocked cookies go with them)
   */
  private clear(requestId: string, key: 'requestHeaders' | 'responseHeaders'): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    delete pending[key];
    if (key === 'requestHeaders') delete pending.requestBlockedCookies;
    if (key === 'responseHeaders') {
      delete pending.responseStatus;
      delete pending.responseBlockedCookies;
    }
    if (!pending.requestHeaders && !pending.responseHeaders) this.pending.delete(requestId);
  }
}
