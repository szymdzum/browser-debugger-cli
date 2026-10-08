/**
 * Credential redaction for HAR exports.
 *
 * HAR files are made to be shared (bug reports, tickets), so `bdg network har`
 * redacts credentials by default, as Chrome DevTools does since Chrome 130.
 * Chrome's sanitized export drops the `Cookie`, `Set-Cookie` and
 * `Authorization` headers and empties the `cookies` arrays; bdg instead keeps
 * every header, cookie and parameter name (and cookie attributes such as
 * `httpOnly`) with the value `[redacted]`, so the export still shows that a
 * request was authenticated and which cookies were set. It also covers API
 * key, token and session headers, credential query parameters in URLs
 * (`?code=`, `?access_token=`) and credential fields of request bodies
 * (sanitizeBody.ts). `headersSize` and `bodySize` stay those of the captured
 * request. Response bodies and WebSocket messages are not redacted.
 */

import type { Cookie, Entry, Header, QueryParam } from './types.js';

import {
  REDACTED,
  isSensitiveField,
  redactPairs,
  redactRequestBody,
} from '@/telemetry/har/sanitizeBody.js';

/** {@link REDACTED} as written in a URL */
const URL_REDACTED = encodeURIComponent(REDACTED);

/** Headers whose values are credentials, lowercased (others match by pattern) */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'authentication',
  'cookie',
  'set-cookie',
]);

/** Custom headers carrying keys or tokens (`X-Api-Key`, `X-Auth-Token`, `X-CSRF-Token`) */
const SENSITIVE_CUSTOM_HEADER = /^x-.*(key|token|secret|auth)/i;

/**
 * Headers with a credential segment between hyphens (`api-key`,
 * `private-token`, `cf-access-jwt-assertion`, `ocp-apim-subscription-key`,
 * `session-id`); `www-authenticate` and `proxy-authenticate` do not match
 */
const SENSITIVE_HEADER_SEGMENT =
  /(^|-)(api-?key|apikey|token|secret|jwt|subscription-key|session(-?id)?)(-|$)/i;

/** Headers whose values are URLs that may carry credential parameters */
const URL_HEADERS = new Set(['location', 'referer']);

/** Query parameter names that hold credentials in URLs only (OAuth codes, signed URLs, API keys) */
const SENSITIVE_URL_PARAM = /^(code|sig|key)$/i;

/**
 * Redact the credentials of a HAR entry.
 *
 * @param entry - Entry built from the captured request
 * @returns Copy of the entry with credential values replaced by {@link REDACTED}
 */
export function sanitizeEntry(entry: Entry): Entry {
  const { request, response } = entry;
  const postData = request.postData;
  return {
    ...entry,
    request: {
      ...request,
      url: redactUrl(request.url),
      cookies: request.cookies.map(redactCookie),
      headers: request.headers.map(redactHeader),
      queryString: request.queryString.map(redactQueryParam),
      ...(postData?.text !== undefined && {
        postData: { ...postData, text: redactRequestBody(postData.text, postData.mimeType) },
      }),
    },
    response: {
      ...response,
      cookies: response.cookies.map(redactCookie),
      headers: response.headers.map(redactHeader),
      redirectURL: redactUrl(response.redirectURL),
    },
  };
}

/**
 * Whether a header carries a credential.
 *
 * @param name - Header name (any case)
 * @returns True for auth, cookie, API key, token, secret and session headers
 */
function isSensitiveHeader(name: string): boolean {
  return (
    SENSITIVE_HEADERS.has(name.toLowerCase()) ||
    SENSITIVE_CUSTOM_HEADER.test(name) ||
    SENSITIVE_HEADER_SEGMENT.test(name)
  );
}

/**
 * Redact a header's value if it carries a credential, or the credential
 * parameters of a `Location` or `Referer` URL.
 *
 * @param header - HAR header
 * @returns The header, or a copy with its value redacted
 */
function redactHeader(header: Header): Header {
  if (isSensitiveHeader(header.name)) return { ...header, value: REDACTED };
  if (!URL_HEADERS.has(header.name.toLowerCase())) return header;
  const value = redactUrl(header.value);
  return value === header.value ? header : { ...header, value };
}

/**
 * Redact a cookie's value, keeping its name and attributes.
 *
 * @param cookie - HAR cookie
 * @returns Copy with the value redacted
 */
function redactCookie(cookie: Cookie): Cookie {
  return { ...cookie, value: REDACTED };
}

/**
 * Whether a URL query or fragment parameter holds a credential.
 *
 * @param name - Decoded parameter name
 * @returns True for credential field names, `code`, `sig` and `key`
 */
function isSensitiveParam(name: string): boolean {
  return isSensitiveField(name) || SENSITIVE_URL_PARAM.test(name);
}

/**
 * Redact a parsed query parameter if it holds a credential.
 *
 * @param param - HAR query parameter
 * @returns The parameter, or a copy with its value redacted
 */
function redactQueryParam(param: QueryParam): QueryParam {
  return isSensitiveParam(param.name) ? { ...param, value: REDACTED } : param;
}

/**
 * Redact credential parameter values in a URL's query and fragment
 * (`#access_token=` of the OAuth implicit flow), leaving the rest byte for byte.
 *
 * @param url - URL (empty for none)
 * @returns URL with credential values replaced by the URL-encoded {@link REDACTED}
 */
function redactUrl(url: string): string {
  const hash = url.indexOf('#');
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment =
    hash === -1 ? '' : `#${redactPairs(url.slice(hash + 1), isSensitiveParam, URL_REDACTED)}`;
  const question = beforeHash.indexOf('?');
  if (question === -1) return beforeHash + fragment;
  const query = redactPairs(beforeHash.slice(question + 1), isSensitiveParam, URL_REDACTED);
  return `${beforeHash.slice(0, question)}?${query}${fragment}`;
}
