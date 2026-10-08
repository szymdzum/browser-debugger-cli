/**
 * HAR (HTTP Archive) builder for transforming network telemetry to HAR 1.2 format.
 */

import { createRequire } from 'node:module';

import type {
  HAR,
  Entry,
  Request,
  Response,
  Content,
  Header,
  Cookie,
  Timings,
  Cache,
  QueryParam,
  PostData,
  WebSocketMessage,
} from './types.js';
import type * as Http from 'node:http';

import { sanitizeEntry } from '@/telemetry/har/sanitize.js';
import { skippedBodyReason } from '@/telemetry/networkRetention.js';
import type { NetworkRequest, WebSocketFrame } from '@/types.js';
import { harSanitizedComment } from '@/ui/messages/networkMessages.js';

/**
 * Loads Node builtins on first use: importing `node:http` in an ES module
 * reads all its exports, which loads undici and zlib (about 8 ms of every CLI
 * start), though only `network har` needs the status texts.
 */
const requireBuiltin = createRequire(import.meta.url);

/**
 * Metadata for HAR generation.
 */
export interface HARMetadata {
  /** bdg version */
  version: string;
  /** Chrome version (optional) */
  chromeVersion?: string;
  /** Session start time (optional) */
  startTime?: number;
  /** Target URL (optional) */
  targetUrl?: string;
  /** Target title (optional) */
  targetTitle?: string;
}

/**
 * Options for HAR generation.
 */
export interface HAROptions {
  /** Keep credentials as captured instead of redacting them (see sanitize.ts) */
  includeSensitive?: boolean;
}

const UNKNOWN_TIMING = -1;
const DEFAULT_HTTP_VERSION = 'HTTP/1.1';

/**
 * Build HAR 1.2 format from network telemetry data.
 *
 * Credentials are redacted (`log.comment` says so) unless
 * `options.includeSensitive` is set.
 *
 * @param requests - Array of network requests collected during session
 * @param metadata - Metadata for HAR creator/browser info
 * @param options - Whether to keep credentials
 * @returns Complete HAR object
 *
 * @remarks
 * Phase 1 implementation uses existing NetworkRequest data with placeholders
 * for missing timing/size fields. Phase 2 will include real timing data.
 *
 * @example
 * ```typescript
 * const har = buildHAR(requests, {
 *   version: '0.6.2',
 *   chromeVersion: '131.0.6778.86',
 *   startTime: Date.now()
 * });
 * fs.writeFileSync('capture.har', JSON.stringify(har, null, 2));
 * ```
 */
export function buildHAR(
  requests: NetworkRequest[],
  metadata: HARMetadata,
  options: HAROptions = {}
): HAR {
  const built = [...requests].sort((a, b) => a.timestamp - b.timestamp).map(buildEntry);
  const entries = options.includeSensitive ? built : built.map(sanitizeEntry);

  const log: HAR['log'] = {
    version: '1.2',
    creator: {
      name: 'bdg',
      version: metadata.version,
      comment: 'Browser Debugger CLI - https://github.com/szymdzum/browser-debugger-cli',
    },
    entries,
    ...(!options.includeSensitive && { comment: harSanitizedComment() }),
  };

  if (metadata.chromeVersion) {
    log.browser = {
      name: 'Chrome',
      version: metadata.chromeVersion,
    };
  }

  return { log };
}

/**
 * Build HAR entry from NetworkRequest.
 *
 * @param req - Network request data
 * @returns HAR entry object
 */
function buildEntry(req: NetworkRequest): Entry {
  const timings = buildTimings(req);
  const entry: Entry = {
    startedDateTime: new Date(req.timestamp).toISOString(),
    time: calculateTotalTime(timings),
    request: buildRequest(req),
    response: buildResponse(req),
    cache: buildCache(),
    timings,
  };

  if (req.serverIPAddress) {
    entry.serverIPAddress = req.serverIPAddress;
  }

  if (req.connection) {
    entry.connection = req.connection;
  }

  if (req.resourceType) {
    entry._resourceType = req.resourceType;
  }

  if (req.webSocket) {
    entry._webSocketMessages = req.webSocket.frames.map(buildWebSocketMessage);
  }

  return entry;
}

/**
 * Build a HAR WebSocket message from a captured frame.
 *
 * @param frame - Captured WebSocket frame
 * @returns HAR WebSocket message
 */
function buildWebSocketMessage(frame: WebSocketFrame): WebSocketMessage {
  return {
    type: frame.direction === 'sent' ? 'send' : 'receive',
    time: frame.timestamp / 1000,
    opcode: frame.opcode,
    data: frame.payloadData,
    ...(frame.truncatedFrom !== undefined && { _truncatedFrom: frame.truncatedFrom }),
  };
}

/**
 * Build HAR request object.
 *
 * @param req - Network request data
 * @returns HAR request object
 */
function buildRequest(req: NetworkRequest): Request {
  const url = new URL(req.url);
  const request: Request = {
    method: req.method,
    url: req.url,
    httpVersion: DEFAULT_HTTP_VERSION,
    cookies: extractRequestCookies(req.requestHeaders),
    headers: convertHeaders(req.requestHeaders),
    queryString: extractQueryParams(url),
    headersSize: estimateRequestHeadersSize(req.method, req.url, req.requestHeaders),
    bodySize: requestBodySize(req),
  };

  const postData = buildPostData(req);
  if (postData) {
    request.postData = postData;
  }

  return request;
}

/**
 * Build HAR response object.
 *
 * @param req - Network request data
 * @returns HAR response object
 */
function buildResponse(req: NetworkRequest): Response {
  const bodySize = req.encodedDataLength ?? req.decodedBodyLength ?? 0;

  return {
    status: req.status ?? 0,
    statusText: req.statusText ?? getStatusText(req.status),
    ...(req.status === 0 && req.errorText && { _error: req.errorText }),
    httpVersion: DEFAULT_HTTP_VERSION,
    cookies: extractResponseCookies(req.responseHeaders),
    headers: convertHeaders(req.responseHeaders),
    content: buildContent(req),
    redirectURL: extractRedirectURL(req),
    headersSize: estimateResponseHeadersSize(req.status, req.responseHeaders),
    bodySize,
  };
}

/**
 * Build the HAR content object for a response.
 *
 * A body that bdg chose not to fetch is exported without `text` and with the
 * reason as `comment`, instead of the placeholder pretending to be the body.
 *
 * @param req - Network request
 * @returns HAR content
 */
function buildContent(req: NetworkRequest): Content {
  const mimeType = req.mimeType ?? 'application/octet-stream';
  const skipped = skippedBodyReason(req.responseBody);
  if (skipped !== undefined) {
    return {
      size: req.decodedBodyLength ?? contentLength(req) ?? req.encodedDataLength ?? 0,
      mimeType,
      comment: `Body not captured: ${skipped}`,
    };
  }
  const size =
    req.decodedBodyLength ?? (req.responseBody ? Buffer.byteLength(req.responseBody, 'utf-8') : 0);
  const text = typeof req.responseBody === 'string' ? req.responseBody : undefined;
  const encoding = req.responseBodyBase64 ? 'base64' : undefined;
  return {
    size,
    mimeType,
    ...(text !== undefined && { text }),
    ...(encoding !== undefined && { encoding }),
  };
}

/**
 * Body size announced by the server (`encodedDataLength` also counts headers).
 *
 * @param req - Network request
 * @returns Content-Length in bytes, if given
 */
function contentLength(req: NetworkRequest): number | undefined {
  const value = getHeader(req.responseHeaders, 'content-length');
  const bytes = value === undefined ? NaN : Number(value);
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

/**
 * Size of the request body: unknown (-1) when it was evicted at the body budget.
 *
 * @param req - Network request data
 * @returns Body size in bytes, or -1
 */
function requestBodySize(req: NetworkRequest): number {
  if (!req.requestBody) return 0;
  if (skippedBodyReason(req.requestBody) !== undefined) return -1;
  return Buffer.byteLength(req.requestBody, 'utf-8');
}

/**
 * Build POST data object if request has body. A body bdg did not keep is
 * exported without `text` and with the reason as `comment`.
 *
 * @param req - Network request data
 * @returns POST data object or undefined
 */
function buildPostData(req: NetworkRequest): PostData | undefined {
  if (!req.requestBody) return undefined;

  const mimeType = getHeader(req.requestHeaders, 'content-type') ?? 'text/plain';
  const skipped = skippedBodyReason(req.requestBody);
  if (skipped !== undefined) return { mimeType, comment: `Body not captured: ${skipped}` };

  return { mimeType, text: req.requestBody };
}

/**
 * Duration between two CDP timing offsets (ms), or -1 if either is unknown.
 *
 * @param start - Start offset (-1 when not applicable)
 * @param end - End offset (-1 when not applicable)
 * @returns Duration in ms, or -1
 */
function span(start: number | undefined, end: number | undefined): number {
  if (start === undefined || end === undefined || start < 0 || end < 0 || end < start) {
    return UNKNOWN_TIMING;
  }
  return end - start;
}

/**
 * Build HAR timings from CDP resource timing.
 *
 * HAR 1.2: blocked/dns/connect/ssl may be -1 (not applicable); send, wait
 * and receive are required to be non-negative. A response served from the
 * browser cache carries the timing of the request that originally fetched
 * it, so only its measured duration is used.
 *
 * @param req - Network request
 * @returns HAR timings
 */
function buildTimings(req: NetworkRequest): Timings {
  const t = req.timing;
  if (!t || req.fromCache) {
    return {
      blocked: UNKNOWN_TIMING,
      dns: UNKNOWN_TIMING,
      connect: UNKNOWN_TIMING,
      send: 0,
      wait: 0,
      receive: req.fromCache ? (req.duration ?? 0) : 0,
      ssl: UNKNOWN_TIMING,
    };
  }
  const receive =
    req.loadingFinishedTime !== undefined &&
    t.requestTime !== undefined &&
    t.receiveHeadersEnd !== undefined
      ? (req.loadingFinishedTime - t.requestTime) * 1000 - t.receiveHeadersEnd
      : 0;
  return {
    blocked: t.dnsStart !== undefined && t.dnsStart >= 0 ? t.dnsStart : UNKNOWN_TIMING,
    dns: span(t.dnsStart, t.dnsEnd),
    connect: span(t.connectStart, t.connectEnd),
    ssl: span(t.sslStart, t.sslEnd),
    send: Math.max(0, span(t.sendStart, t.sendEnd)),
    wait: Math.max(0, span(t.sendEnd, t.receiveHeadersEnd)),
    receive: Math.max(0, receive),
  };
}

/**
 * Build cache object (empty for Phase 1).
 *
 * @returns Empty cache object
 */
function buildCache(): Cache {
  return {};
}

/**
 * Calculate total request time from timings breakdown.
 *
 * @param timings - HAR timings object
 * @returns Total time in milliseconds
 *
 * @remarks
 * Sums all timing phases (except SSL which overlaps with connect).
 * Returns 0 if no timing data available.
 */
function calculateTotalTime(timings: Timings): number {
  const phases = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const;

  return phases.reduce((total, phase) => {
    const time = timings[phase];
    return total + (time !== undefined && time >= 0 ? time : 0);
  }, 0);
}

/**
 * Convert headers object to HAR header array.
 *
 * @param headers - Headers object
 * @returns Array of HAR header objects
 */
function convertHeaders(headers: Record<string, string> | undefined): Header[] {
  if (!headers) return [];

  return Object.entries(headers).map(([name, value]) => ({
    name,
    value,
  }));
}

/**
 * Look up a header value case-insensitively.
 *
 * CDP keeps the original header casing for HTTP/1.1 (`Content-Type`,
 * `Set-Cookie`) and lowercases it for HTTP/2.
 *
 * @param headers - Header map
 * @param name - Header name (any case)
 * @returns Header value, if present
 */
function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : headers[key];
}

/**
 * Extract request cookies from the `Cookie` header.
 *
 * @param headers - Request headers
 * @returns HAR cookies
 */
function extractRequestCookies(headers: Record<string, string> | undefined): Cookie[] {
  const header = getHeader(headers, 'cookie');
  if (!header) return [];
  return header
    .split(';')
    .map((pair) => parseNameValue(pair))
    .filter((cookie): cookie is Cookie => cookie !== null);
}

/**
 * Extract response cookies from `Set-Cookie` headers.
 *
 * CDP joins multiple `Set-Cookie` headers with newlines; each line is one
 * cookie whose first `name=value` pair is the cookie and the rest are
 * attributes (Path, Domain, Expires, HttpOnly, Secure).
 *
 * @param headers - Response headers
 * @returns HAR cookies
 */
function extractResponseCookies(headers: Record<string, string> | undefined): Cookie[] {
  const header = getHeader(headers, 'set-cookie');
  if (!header) return [];
  return header
    .split('\n')
    .map(parseSetCookie)
    .filter((cookie): cookie is Cookie => cookie !== null);
}

/**
 * Parse a `name=value` pair.
 *
 * @param pair - Raw pair
 * @returns Cookie, or null if there is no name
 */
function parseNameValue(pair: string): Cookie | null {
  const eq = pair.indexOf('=');
  const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
  if (!name) return null;
  return { name, value: eq === -1 ? '' : pair.slice(eq + 1).trim() };
}

/**
 * Parse one `Set-Cookie` header line.
 *
 * @param line - Header line
 * @returns Cookie with attributes, or null if malformed
 */
function parseSetCookie(line: string): Cookie | null {
  const [first = '', ...attributes] = line.split(';');
  const cookie = parseNameValue(first);
  if (!cookie) return null;
  for (const attribute of attributes) {
    const { name, value } = parseNameValue(attribute) ?? { name: '', value: '' };
    switch (name.toLowerCase()) {
      case 'path':
        cookie.path = value;
        break;
      case 'domain':
        cookie.domain = value;
        break;
      case 'expires': {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) cookie.expires = date.toISOString();
        break;
      }
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      default:
        break;
    }
  }
  return cookie;
}

/**
 * Extract query parameters from URL.
 *
 * @param url - Parsed URL object
 * @returns Array of HAR query parameter objects
 */
function extractQueryParams(url: URL): QueryParam[] {
  const params: QueryParam[] = [];

  url.searchParams.forEach((value, name) => {
    params.push({ name, value });
  });

  return params;
}

/**
 * Determine the redirect target of a response.
 *
 * @param req - Network request
 * @returns Redirect URL, or '' when the response is not a redirect
 */
function extractRedirectURL(req: NetworkRequest): string {
  return req.redirectURL ?? getHeader(req.responseHeaders, 'location') ?? '';
}

/**
 * Estimate request headers size in bytes including HTTP request line.
 *
 * @param method - HTTP method
 * @param url - Request URL
 * @param headers - Headers object
 * @returns Estimated size in bytes
 *
 * @remarks
 * Includes HTTP request line (e.g., "GET /path HTTP/1.1" with CRLF) plus headers and final CRLF.
 * Format: "METHOD /path HTTP/version" then "Header: value" lines, all terminated with CRLF
 */
function estimateRequestHeadersSize(
  method: string,
  url: string,
  headers: Record<string, string> | undefined
): number {
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname + parsedUrl.search;

  const requestLine = `${method} ${path} ${DEFAULT_HTTP_VERSION}\r\n`;

  const headersString = headers
    ? Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join('')
    : '';

  const finalCRLF = '\r\n';

  return Buffer.byteLength(requestLine + headersString + finalCRLF, 'utf-8');
}

/**
 * Estimate response headers size in bytes including HTTP status line.
 *
 * @param status - HTTP status code
 * @param headers - Headers object
 * @returns Estimated size in bytes
 *
 * @remarks
 * Includes HTTP status line (e.g., "HTTP/1.1 200 OK" with CRLF) plus headers and final CRLF.
 * Format: "HTTP/version STATUS Text" then "Header: value" lines, all terminated with CRLF
 */
function estimateResponseHeadersSize(
  status: number | undefined,
  headers: Record<string, string> | undefined
): number {
  const statusText = getStatusText(status);
  const statusLine = `${DEFAULT_HTTP_VERSION} ${status ?? 0} ${statusText}\r\n`;

  const headersString = headers
    ? Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join('')
    : '';

  const finalCRLF = '\r\n';

  return Buffer.byteLength(statusLine + headersString + finalCRLF, 'utf-8');
}

/**
 * Get HTTP status text from status code.
 *
 * @param status - HTTP status code
 * @returns Status text
 */
function getStatusText(status: number | undefined): string {
  if (!status) return '';
  return (requireBuiltin('node:http') as typeof Http).STATUS_CODES[status] ?? '';
}
