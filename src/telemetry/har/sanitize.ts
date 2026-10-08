/**
 * Credential redaction for HAR exports.
 *
 * HAR files are made to be shared (bug reports, tickets), so `bdg network har`
 * redacts credentials by default, as Chrome DevTools does since Chrome 130.
 * Chrome's sanitized export drops the `Cookie`, `Set-Cookie` and
 * `Authorization` headers and empties the `cookies` arrays; bdg instead keeps
 * every header and cookie name (and cookie attributes such as `httpOnly`) with
 * the value `[redacted]`, so the export still shows that a request was
 * authenticated and which cookies were set, and also covers API key and token
 * headers and password- and token-like fields of request bodies.
 * `headersSize` and `bodySize` stay those of the captured request.
 */

import type { Cookie, Entry, Header, PostData } from './types.js';

import { SENSITIVE_NAME_SOURCE } from '@/runtime/dom/elementInfo.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('network');

/** Replaces a credential value */
export const REDACTED = '[redacted]';

/** Headers whose values are credentials, lowercased */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'api-key',
]);

/** Custom headers carrying keys or tokens (`X-Api-Key`, `X-Auth-Token`, `X-CSRF-Token`) */
const SENSITIVE_CUSTOM_HEADER = /^x-.*(key|token|secret|auth)/i;

/**
 * Body field names holding credentials: password-like names (shared with
 * form masking), tokens, secrets, API keys, authorization and credentials
 */
const SENSITIVE_FIELD = new RegExp(
  `${SENSITIVE_NAME_SOURCE}|token|secret|api[-_]?key|authoriz|credential`,
  'i'
);

/**
 * Redact the credentials of a HAR entry.
 *
 * @param entry - Entry built from the captured request
 * @returns Copy of the entry with credential values replaced by {@link REDACTED}
 */
export function sanitizeEntry(entry: Entry): Entry {
  const { request, response } = entry;
  return {
    ...entry,
    request: {
      ...request,
      cookies: request.cookies.map(redactCookie),
      headers: request.headers.map(redactHeader),
      ...(request.postData && { postData: redactPostData(request.postData) }),
    },
    response: {
      ...response,
      cookies: response.cookies.map(redactCookie),
      headers: response.headers.map(redactHeader),
    },
  };
}

/**
 * Whether a header carries a credential.
 *
 * @param name - Header name (any case)
 * @returns True for auth, cookie, API key and token headers
 */
function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase()) || SENSITIVE_CUSTOM_HEADER.test(name);
}

/**
 * Redact a header's value if it carries a credential.
 *
 * @param header - HAR header
 * @returns The header, or a copy with its value redacted
 */
function redactHeader(header: Header): Header {
  return isSensitiveHeader(header.name) ? { ...header, value: REDACTED } : header;
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
 * Redact credential fields of a request body.
 *
 * @param postData - HAR post data
 * @returns The post data, or a copy with credential fields redacted
 */
function redactPostData(postData: PostData): PostData {
  if (postData.text === undefined) return postData;
  const text = /x-www-form-urlencoded/i.test(postData.mimeType)
    ? redactFormBody(postData.text)
    : redactJsonBody(postData.text);
  return text === postData.text ? postData : { ...postData, text };
}

/**
 * Redact credential fields of a form-urlencoded body, leaving the other
 * pairs byte for byte.
 *
 * @param text - Body like `user=ann&password=hunter2`
 * @returns Body with credential values replaced
 */
function redactFormBody(text: string): string {
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1 || !SENSITIVE_FIELD.test(decodeFormName(pair.slice(0, eq)))) return pair;
      return `${pair.slice(0, eq)}=${REDACTED}`;
    })
    .join('&');
}

/**
 * Decode a form field name.
 *
 * @param name - Encoded name
 * @returns Decoded name, or the raw name when it is not valid encoding
 */
function decodeFormName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '));
  } catch (error) {
    log.debug(`Form field name not decodable: ${getErrorMessage(error)}`);
    return name;
  }
}

/**
 * Redact credential fields of a JSON body, at any depth.
 *
 * @param text - Body text
 * @returns Re-serialized JSON when a field was redacted, else the text unchanged
 *   (also when it is not JSON)
 */
function redactJsonBody(text: string): string {
  if (!/^\s*[[{]/.test(text)) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    log.debug(`Request body not JSON: ${getErrorMessage(error)}`);
    return text;
  }
  return redactFields(parsed) ? JSON.stringify(parsed) : text;
}

/**
 * Replace values of credential fields in parsed JSON, in place.
 *
 * @param value - Parsed JSON value
 * @returns True when a field was redacted
 */
function redactFields(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.map(redactFields).includes(true);
  }
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  let redacted = false;
  for (const [key, field] of Object.entries(record)) {
    if (SENSITIVE_FIELD.test(key)) {
      record[key] = REDACTED;
      redacted = true;
    } else if (redactFields(field)) {
      redacted = true;
    }
  }
  return redacted;
}
