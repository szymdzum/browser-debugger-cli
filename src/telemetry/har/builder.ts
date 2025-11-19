/**
 * HAR (HTTP Archive) builder for transforming network telemetry to HAR 1.2 format.
 */

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
} from './types.js';

import type { NetworkRequest } from '@/types.js';

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

const UNKNOWN_TIMING = -1;
const DEFAULT_HTTP_VERSION = 'HTTP/1.1';

/**
 * Build HAR 1.2 format from network telemetry data.
 *
 * @param requests - Array of network requests collected during session
 * @param metadata - Metadata for HAR creator/browser info
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
export function buildHAR(requests: NetworkRequest[], metadata: HARMetadata): HAR {
  const entries = requests.map((req) => buildEntry(req));

  const log: HAR['log'] = {
    version: '1.2',
    creator: {
      name: 'bdg',
      version: metadata.version,
      comment: 'Browser Debugger CLI - https://github.com/szymdzum/browser-debugger-cli',
    },
    entries,
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

  return entry;
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
    cookies: extractCookies(req.requestHeaders),
    headers: convertHeaders(req.requestHeaders),
    queryString: extractQueryParams(url),
    headersSize: estimateRequestHeadersSize(req.method, req.url, req.requestHeaders),
    bodySize: req.requestBody ? Buffer.byteLength(req.requestBody, 'utf-8') : 0,
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
  const bodySize =
    req.encodedDataLength ?? (req.responseBody ? Buffer.byteLength(req.responseBody, 'utf-8') : 0);

  return {
    status: req.status ?? 0,
    statusText: getStatusText(req.status),
    httpVersion: DEFAULT_HTTP_VERSION,
    cookies: extractCookies(req.responseHeaders),
    headers: convertHeaders(req.responseHeaders),
    content: buildContent(req),
    redirectURL: extractRedirectURL(req.responseHeaders),
    headersSize: estimateResponseHeadersSize(req.status, req.responseHeaders),
    bodySize,
  };
}

/**
 * Build content object for response body.
 *
 * @param req - Network request data
 * @returns HAR content object
 *
 * @remarks
 * Uses decodedBodyLength if available, otherwise calculates from responseBody.
 * The size field represents the uncompressed/decoded content size.
 */
function buildContent(req: NetworkRequest): Content {
  const { text, encoding } = encodeBody(req.responseBody, req.mimeType);
  const size =
    req.decodedBodyLength ?? (req.responseBody ? Buffer.byteLength(req.responseBody, 'utf-8') : 0);

  const content: Content = {
    size,
    mimeType: req.mimeType ?? 'application/octet-stream',
  };

  if (text !== undefined) {
    content.text = text;
  }

  if (encoding !== undefined) {
    content.encoding = encoding;
  }

  return content;
}

/**
 * Encode response body with appropriate encoding.
 *
 * Auto-detects binary content and applies base64 encoding.
 *
 * @param body - Response body string
 * @param mimeType - Response MIME type
 * @returns Encoded text and encoding type
 */
function encodeBody(
  body: string | undefined,
  mimeType: string | undefined
): { text?: string; encoding?: string } {
  if (!body) {
    return {};
  }

  if (isBinaryMimeType(mimeType)) {
    return {
      text: Buffer.from(body).toString('base64'),
      encoding: 'base64',
    };
  }

  return { text: body };
}

/**
 * Check if MIME type represents binary content.
 *
 * @param mimeType - MIME type to check
 * @returns True if binary content
 */
function isBinaryMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;

  const binaryTypes = ['image/', 'video/', 'audio/', 'application/pdf', 'application/zip'];

  return binaryTypes.some((type) => mimeType.startsWith(type));
}

/**
 * Build POST data object if request has body.
 *
 * @param req - Network request data
 * @returns POST data object or undefined
 */
function buildPostData(req: NetworkRequest): PostData | undefined {
  if (!req.requestBody) return undefined;

  const contentType = req.requestHeaders?.['content-type'] ?? 'text/plain';

  return {
    mimeType: contentType,
    params: [],
    text: req.requestBody,
  };
}

/**
 * Build timing object from NetworkRequest timing data.
 *
 * @param req - Network request data
 * @returns HAR timings object
 *
 * @remarks
 * Uses real timing data from CDP Network.responseReceived event.
 * Falls back to -1 (unknown) for missing timing fields (HAR spec compliant).
 *
 * HAR timing breakdown:
 * - blocked: Time waiting for network slot (DNS queue time)
 * - dns: DNS resolution time
 * - connect: TCP connection time
 * - ssl: SSL/TLS handshake time (if HTTPS)
 * - send: Time sending HTTP request
 * - wait: Time waiting for server response (TTFB)
 * - receive: Time receiving response data
 */
function buildTimings(req: NetworkRequest): Timings {
  if (!req.timing) {
    return {
      blocked: UNKNOWN_TIMING,
      dns: UNKNOWN_TIMING,
      connect: UNKNOWN_TIMING,
      send: UNKNOWN_TIMING,
      wait: UNKNOWN_TIMING,
      receive: UNKNOWN_TIMING,
      ssl: UNKNOWN_TIMING,
    };
  }

  const t = req.timing;

  const blocked = t.dnsStart !== undefined && t.dnsStart >= 0 ? t.dnsStart : UNKNOWN_TIMING;

  const dns =
    t.dnsStart !== undefined &&
    t.dnsEnd !== undefined &&
    t.dnsStart >= 0 &&
    t.dnsEnd >= 0 &&
    t.dnsEnd > t.dnsStart
      ? t.dnsEnd - t.dnsStart
      : UNKNOWN_TIMING;

  const connect =
    t.connectStart !== undefined &&
    t.connectEnd !== undefined &&
    t.connectStart >= 0 &&
    t.connectEnd >= 0 &&
    t.connectEnd > t.connectStart
      ? t.connectEnd - t.connectStart
      : UNKNOWN_TIMING;

  const ssl =
    t.sslStart !== undefined &&
    t.sslEnd !== undefined &&
    t.sslStart >= 0 &&
    t.sslEnd >= 0 &&
    t.sslEnd > t.sslStart
      ? t.sslEnd - t.sslStart
      : UNKNOWN_TIMING;

  const send =
    t.sendStart !== undefined &&
    t.sendEnd !== undefined &&
    t.sendStart >= 0 &&
    t.sendEnd >= 0 &&
    t.sendEnd > t.sendStart
      ? t.sendEnd - t.sendStart
      : UNKNOWN_TIMING;

  const wait =
    t.sendEnd !== undefined &&
    t.receiveHeadersEnd !== undefined &&
    t.sendEnd >= 0 &&
    t.receiveHeadersEnd >= 0 &&
    t.receiveHeadersEnd > t.sendEnd
      ? t.receiveHeadersEnd - t.sendEnd
      : UNKNOWN_TIMING;

  const receive =
    req.loadingFinishedTime !== undefined &&
    t.requestTime !== undefined &&
    t.receiveHeadersEnd !== undefined &&
    t.receiveHeadersEnd >= 0
      ? (req.loadingFinishedTime - t.requestTime) * 1000 - t.receiveHeadersEnd
      : UNKNOWN_TIMING;

  return {
    blocked,
    dns,
    connect,
    send,
    wait,
    receive,
    ssl,
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
 * Extract cookies from headers.
 *
 * @param headers - Headers object
 * @returns Array of HAR cookie objects
 */
function extractCookies(headers: Record<string, string> | undefined): Cookie[] {
  if (!headers) return [];

  const cookieHeader = headers['cookie'] ?? headers['set-cookie'];
  if (!cookieHeader) return [];

  return parseCookies(cookieHeader);
}

/**
 * Parse cookie header string into HAR cookie objects.
 *
 * @param cookieHeader - Cookie header string
 * @returns Array of HAR cookie objects
 */
function parseCookies(cookieHeader: string): Cookie[] {
  const cookies: Cookie[] = [];
  const cookiePairs = cookieHeader.split(';').map((c) => c.trim());

  for (const pair of cookiePairs) {
    const [name, ...valueParts] = pair.split('=');
    const value = valueParts.join('=');

    if (name && value) {
      cookies.push({ name: name.trim(), value: value.trim() });
    }
  }

  return cookies;
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
 * Extract redirect URL from Location header.
 *
 * @param headers - Response headers
 * @returns Redirect URL or empty string
 */
function extractRedirectURL(headers: Record<string, string> | undefined): string {
  return headers?.['location'] ?? '';
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
  if (!status) return 'Unknown';

  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };

  return statusTexts[status] ?? 'Unknown';
}
