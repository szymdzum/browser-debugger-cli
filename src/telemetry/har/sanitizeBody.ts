/**
 * Credential redaction in request and response bodies, WebSocket text
 * messages and `name=value` lists, for sanitized HAR exports (see sanitize.ts).
 *
 * Matching is by field name only, so it over-redacts: any primitive whose
 * name looks like a credential (`tokenCount: 5`) is replaced too.
 */

import { SENSITIVE_NAME_SOURCE } from '@/runtime/dom/elementInfo.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('network');

/** Replaces a credential value */
export const REDACTED = '[redacted]';

/**
 * Field names holding credentials: password-like names (shared with form
 * masking), tokens, secrets, keys, sessions, signatures and credentials
 */
const SENSITIVE_FIELD = new RegExp(
  `${SENSITIVE_NAME_SOURCE}|token|secret|api[-_]?key|authoriz|credential|jwt|private[-_]?key|access[-_]?key|session|signature`,
  'i'
);

/** A body that is a form whatever its Content-Type: `k=v&k=v`, no whitespace, not JSON */
const FORM_BODY = /^[^\s=&{["]+=[^\s&]*(?:&[^\s=&]+=[^\s&]*)*$/;

/**
 * Whether a body field, form field or query parameter name looks like it
 * holds a credential.
 *
 * @param name - Field name
 * @returns True for password, token, secret, key, session and signature names
 */
export function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD.test(name);
}

/**
 * Redact credential values in an `&`-separated `name=value` list (a form body,
 * query string or fragment), leaving the other pairs byte for byte.
 *
 * @param text - List like `user=ann&password=hunter2`
 * @param isSensitive - Whether a decoded name holds a credential
 * @param replacement - Value written instead
 * @returns List with credential values replaced
 */
export function redactPairs(
  text: string,
  isSensitive: (name: string) => boolean,
  replacement: string
): string {
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1 || !isSensitive(decodeName(pair.slice(0, eq)))) return pair;
      return `${pair.slice(0, eq)}=${replacement}`;
    })
    .join('&');
}

/**
 * Redact credential fields of a body or WebSocket text message: multipart
 * parts, form fields (by Content-Type or shape) and JSON fields at any depth.
 *
 * @param text - Body text
 * @param mimeType - Content-Type of the body (empty for a WebSocket message)
 * @returns Body with credential values replaced; the text unchanged when
 *   there were none or it is neither JSON, a form nor multipart
 */
export function redactBody(text: string, mimeType: string): string {
  if (/multipart\/form-data/i.test(mimeType)) return redactMultipart(text, mimeType);
  if (/x-www-form-urlencoded/i.test(mimeType) || FORM_BODY.test(text)) {
    return redactPairs(text, isSensitiveField, REDACTED);
  }
  return redactJsonBody(text);
}

/**
 * Decode a form or query name.
 *
 * @param name - Encoded name
 * @returns Decoded name, or the raw name when it is not valid encoding
 */
function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '));
  } catch (error) {
    log.debug(`Field name not decodable: ${getErrorMessage(error)}`);
    return name;
  }
}

/**
 * Redact the values of credential parts of a multipart body, leaving the
 * other parts byte for byte.
 *
 * @param text - Body text
 * @param mimeType - Content-Type with the boundary
 * @returns Body with credential part values replaced
 */
function redactMultipart(text: string, mimeType: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(mimeType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return text;
  const delimiter = `--${boundary}`;
  return text.split(delimiter).map(redactPart).join(delimiter);
}

/**
 * Redact the value of one multipart part if its name holds a credential.
 *
 * @param part - Text between two boundary delimiters
 * @returns The part, or the part with its value replaced
 */
function redactPart(part: string): string {
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd === -1) return part;
  const name = /;\s*name="([^"]*)"/i.exec(part.slice(0, headerEnd))?.[1];
  if (name === undefined || !isSensitiveField(name)) return part;
  const valueEnd = part.endsWith('\r\n') ? part.length - 2 : part.length;
  return `${part.slice(0, headerEnd + 4)}${REDACTED}${part.slice(valueEnd)}`;
}

/**
 * Redact credential fields of a JSON body or message.
 *
 * @param text - Body text
 * @returns Re-serialized JSON when a field was redacted, the text unchanged
 *   when none was or it is not JSON, and {@link REDACTED} for JSON too deep
 *   to walk
 */
function redactJsonBody(text: string): string {
  if (!/^\s*[[{]/.test(text)) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    log.debug(`Body not JSON: ${getErrorMessage(error)}`);
    return error instanceof SyntaxError ? text : REDACTED;
  }
  try {
    const hits = { count: 0 };
    const redacted = redactJson(parsed, false, hits);
    return hits.count > 0 ? JSON.stringify(redacted) : text;
  } catch (error) {
    log.debug(`Body redacted whole: ${getErrorMessage(error)}`);
    return REDACTED;
  }
}

/**
 * Copy of parsed JSON with the primitives under credential names replaced.
 * Objects and arrays keep their structure; every string, number and boolean
 * inside a credential-named field is replaced, at any depth.
 *
 * @param value - Parsed JSON value
 * @param sensitive - Whether an enclosing field name holds a credential
 * @param hits - Counter of replaced values
 * @returns Redacted copy
 */
function redactJson(value: unknown, sensitive: boolean, hits: { count: number }): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJson(item, sensitive, hits));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        redactJson(field, sensitive || isSensitiveField(key), hits),
      ])
    );
  }
  if (!sensitive || !['string', 'number', 'boolean'].includes(typeof value)) return value;
  hits.count++;
  return REDACTED;
}
