/**
 * Masked network output (#615): `details network`, `network headers` and
 * `network document` show credentials as {@link MASKED_VALUE} unless run with
 * `--include-sensitive`.
 *
 * What counts as a credential is the HAR sanitiser's rule (sanitize.ts,
 * sanitizeBody.ts): auth, cookie, API key, token and session headers; user
 * info and credential parameters of the request URL, redirect URL and URL
 * headers (`Location`, `Referer`, `:path`, `Link`...); JWTs in any header;
 * secret-named fields of request
 * and response bodies and WebSocket messages, and JWTs. Only the placeholder
 * differs, and header values keep what is no secret: cookie names and
 * `Set-Cookie` attributes (`sid=••••; HttpOnly`) and the scheme of an
 * `Authorization` header (`Bearer ••••`). Everything else stays as captured.
 */

import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import { isSensitiveHeader, redactHeaderText, redactUrl } from '@/telemetry/har/sanitize.js';
import {
  redactBase64Body,
  redactBody,
  redactOrReplaceWhole,
} from '@/telemetry/har/sanitizeBody.js';
import { skippedBodyReason } from '@/telemetry/networkRetention.js';
import type { NetworkRequest, WebSocketFrame } from '@/types.js';

/** {@link MASKED_VALUE} as base64, for a binary body or message replaced whole */
const BASE64_MASKED = Buffer.from(MASKED_VALUE).toString('base64');

/** WebSocket opcode of a text message */
const TEXT_OPCODE = 1;

/** WebSocket opcode of a binary message (base64) */
const BINARY_OPCODE = 2;

/** Credential headers whose auth scheme is kept (`Bearer ••••`), lowercased */
const SCHEME_HEADERS = new Set(['authorization', 'proxy-authorization']);

/** An auth scheme followed by credentials: `Bearer abc`, `Basic dXNlcjpwYXNz` */
const AUTH_SCHEME = /^([A-Za-z][\w.+-]*)\s+\S/;

/** A masked copy and whether anything in it was masked */
export interface Masked<T> {
  /** The copy, credentials replaced by {@link MASKED_VALUE} */
  value: T;
  /** Whether at least one value was replaced */
  masked: boolean;
}

/** Fields of a request that `network headers` shows */
interface HeaderFields {
  url: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
}

/**
 * Mask the credentials of a captured request: URLs, headers, request and
 * response bodies and WebSocket messages.
 *
 * @param request - Captured request
 * @returns Masked copy, and whether anything was masked
 */
export function maskNetworkRequest(request: NetworkRequest): Masked<NetworkRequest> {
  const { requestHeaders, responseHeaders, requestBody, responseBody, webSocket } = request;
  const value: NetworkRequest = {
    ...request,
    url: maskUrl(request.url),
    ...(request.redirectURL !== undefined && { redirectURL: maskUrl(request.redirectURL) }),
    ...(requestHeaders && { requestHeaders: maskHeaders(requestHeaders) }),
    ...(responseHeaders && { responseHeaders: maskHeaders(responseHeaders) }),
    ...(requestBody !== undefined && {
      requestBody: maskBody(requestBody, headerValue(requestHeaders, 'content-type'), false),
    }),
    ...(responseBody !== undefined && {
      responseBody: maskBody(responseBody, request.mimeType ?? '', request.responseBodyBase64),
    }),
    ...(webSocket && { webSocket: { ...webSocket, frames: webSocket.frames.map(maskFrame) } }),
  };
  return { value, masked: requestChanged(request, value) };
}

/**
 * Mask the URL and headers of a request as `network headers` shows them.
 *
 * @param data - URL and headers (other fields are kept)
 * @returns Masked copy, and whether anything was masked
 */
export function maskHeaderFields<T extends HeaderFields>(data: T): Masked<T> {
  const value: T = {
    ...data,
    url: maskUrl(data.url),
    requestHeaders: maskHeaders(data.requestHeaders),
    responseHeaders: maskHeaders(data.responseHeaders),
  };
  const masked =
    value.url !== data.url ||
    headersChanged(data.requestHeaders, value.requestHeaders) ||
    headersChanged(data.responseHeaders, value.responseHeaders);
  return { value, masked };
}

/**
 * Mask the user info and credential parameters of a URL.
 *
 * @param url - URL as captured
 * @returns URL without user info, credential values {@link MASKED_VALUE}
 */
function maskUrl(url: string): string {
  return redactUrl(url, MASKED_VALUE);
}

/**
 * Mask the credential values of a header map.
 *
 * @param headers - Headers as captured
 * @returns Copy with credential values masked
 */
function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, maskHeaderValue(name, value)])
  );
}

/**
 * Mask a header's value if it carries a credential, keeping cookie names,
 * `Set-Cookie` attributes and auth schemes; mask the credentials of a URL
 * header and any JWT in other headers. A header sent several times has one
 * value per line.
 *
 * @param name - Header name (any case)
 * @param value - Value as captured
 * @returns The value, masked where it holds a credential
 */
function maskHeaderValue(name: string, value: string): string {
  const lower = name.toLowerCase();
  if (isSensitiveHeader(name)) {
    if (lower === 'cookie') return value.replace(/[^;\n]+/g, maskCookiePair);
    if (lower === 'set-cookie') return value.replace(/^[^;\n]+/gm, maskCookiePair);
    if (SCHEME_HEADERS.has(lower)) return value.replace(/^.+$/gm, maskCredentials);
    return value === '' ? value : MASKED_VALUE;
  }
  return redactHeaderText(name, value, MASKED_VALUE, MASKED_VALUE);
}

/**
 * Mask the value of one cookie, keeping its name and the spaces around it.
 *
 * @param pair - `name=value` (or a nameless value), as written
 * @returns e.g. ` sid=••••`; an empty value stays empty
 */
function maskCookiePair(pair: string): string {
  const eq = pair.indexOf('=');
  if (eq === -1) return pair.trim() === '' ? pair : pair.replace(/\S.*/, MASKED_VALUE);
  return pair.slice(eq + 1).trim() === '' ? pair : `${pair.slice(0, eq + 1)}${MASKED_VALUE}`;
}

/**
 * Mask the credentials of an `Authorization` value, keeping its scheme.
 *
 * @param value - One header value
 * @returns e.g. `Bearer ••••`, or {@link MASKED_VALUE} without a scheme
 */
function maskCredentials(value: string): string {
  const scheme = AUTH_SCHEME.exec(value)?.[1];
  return scheme === undefined ? MASKED_VALUE : `${scheme} ${MASKED_VALUE}`;
}

/**
 * Mask the credential fields of a body. A body bdg did not keep (its
 * placeholder) is left alone; one the sanitiser fails on is masked whole.
 *
 * @param body - Body as captured (base64 when `base64`)
 * @param mimeType - Content-Type of the body
 * @param base64 - Whether the body is base64
 * @returns The body, masked where it holds credentials
 */
function maskBody(body: string, mimeType: string, base64: boolean | undefined): string {
  if (skippedBodyReason(body) !== undefined) return body;
  return base64
    ? redactOrReplaceWhole(
        body,
        (text) => redactBase64Body(text, mimeType, MASKED_VALUE),
        BASE64_MASKED
      )
    : redactOrReplaceWhole(body, (text) => redactBody(text, mimeType, MASKED_VALUE), MASKED_VALUE);
}

/**
 * Mask the credential fields of a WebSocket message: a text message, or a
 * binary one that decodes as UTF-8 text.
 *
 * @param frame - Captured frame
 * @returns The frame, or a copy with its payload masked
 */
function maskFrame(frame: WebSocketFrame): WebSocketFrame {
  if (frame.opcode !== TEXT_OPCODE && frame.opcode !== BINARY_OPCODE) return frame;
  const payloadData = maskBody(frame.payloadData, '', frame.opcode === BINARY_OPCODE);
  return payloadData === frame.payloadData ? frame : { ...frame, payloadData };
}

/**
 * Look up a header value case-insensitively.
 *
 * @param headers - Header map
 * @param name - Lowercase header name
 * @returns Value, or empty when absent
 */
function headerValue(headers: Record<string, string> | undefined, name: string): string {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name);
  return key === undefined ? '' : (headers?.[key] ?? '');
}

/**
 * Whether masking changed any header value.
 *
 * @param before - Headers as captured
 * @param after - Masked headers
 * @returns True when a value differs
 */
function headersChanged(
  before: Record<string, string> | undefined,
  after: Record<string, string> | undefined
): boolean {
  return Object.entries(before ?? {}).some(([name, value]) => after?.[name] !== value);
}

/**
 * Whether masking changed anything in a request.
 *
 * @param before - Request as captured
 * @param after - Masked request
 * @returns True when a URL, header, body or message differs
 */
function requestChanged(before: NetworkRequest, after: NetworkRequest): boolean {
  const frames = after.webSocket?.frames;
  return (
    before.url !== after.url ||
    before.redirectURL !== after.redirectURL ||
    before.requestBody !== after.requestBody ||
    before.responseBody !== after.responseBody ||
    headersChanged(before.requestHeaders, after.requestHeaders) ||
    headersChanged(before.responseHeaders, after.responseHeaders) ||
    (before.webSocket?.frames.some((frame, i) => frame !== frames?.[i]) ?? false)
  );
}
