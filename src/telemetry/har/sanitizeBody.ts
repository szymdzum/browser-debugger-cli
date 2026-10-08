/**
 * Credential redaction in request and response bodies, WebSocket text
 * messages and `name=value` lists, for sanitized HAR exports (see sanitize.ts).
 *
 * Matching is by field name only, so it over-redacts: any primitive whose
 * name looks like a credential (`tokenCount: 5`) is replaced too.
 *
 * JSON is never parsed and re-serialized: a single linear scan replaces the
 * credential values in place, so everything else (64-bit numbers, formatting,
 * duplicate keys, a BOM or `)]}'` prefix) stays byte for byte, and truncated
 * JSON, socket.io packets, server-sent events and NDJSON are covered too.
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
 * Text that holds JSON whatever its Content-Type: after an optional BOM,
 * XSSI guard (`)]}'`) and whitespace, an object or array (also after a
 * socket.io packet type such as `42`) or a server-sent event field
 */
const JSON_LIKE_START = /^\uFEFF?(?:\)\]\}',?)?\s*(?:\d*[[{]|(?:data|event|id|retry):)/;

/** Content-Types whose bodies are scanned as JSON whatever they start with */
const JSON_MIME = /json|event-stream/i;

/** Content-Types of base64 bodies decoded to look for JSON: none, generic binary or JSON */
const DECODABLE_MIME = /^(?:application\/octet-stream|binary\/octet-stream)?$|json/i;

/** A JSON number, or a run of number characters in malformed JSON */
const NUMBER = /[-\d][\d.eE+-]*/y;

/** A bare word: `true`, `false`, `null`, or text around JSON values */
const WORD = /[A-Za-z_$][\w$]*/y;

/** {@link REDACTED} as a JSON string */
const REDACTED_STRING = JSON.stringify(REDACTED);

/** Strict UTF-8 decoder that keeps a BOM */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * State of a scan of JSON-like text.
 */
interface JsonScan {
  /** Text scanned */
  text: string;
  /** Unchanged slices and replacements written so far */
  parts: string[];
  /** End of the text copied into `parts` */
  copied: number;
  /** Whether each open object or array is under a credential name, innermost last */
  containers: boolean[];
  /** Whether the last key read names a credential, until its value is read */
  key: boolean | undefined;
}

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
  return JSON_MIME.test(mimeType) || JSON_LIKE_START.test(text) ? redactJsonText(text) : text;
}

/**
 * Redact credential fields of a base64 body that may be text: one with no,
 * a generic binary or a JSON Content-Type that decodes as UTF-8.
 *
 * @param base64 - Body as base64
 * @param mimeType - Content-Type of the body
 * @returns The redacted body re-encoded, or the input unchanged when it was
 *   not decodable text or held no credentials
 */
export function redactBase64Body(base64: string, mimeType: string): string {
  if (!DECODABLE_MIME.test(mimeType)) return base64;
  let decoded: string;
  try {
    decoded = UTF8.decode(Buffer.from(base64, 'base64'));
  } catch (error) {
    log.debug(`Base64 body is not UTF-8: ${getErrorMessage(error)}`);
    return base64;
  }
  const redacted = redactBody(decoded, mimeType);
  return redacted === decoded ? base64 : Buffer.from(redacted, 'utf8').toString('base64');
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
 * Replace the values under credential names in JSON-like text, in one linear
 * pass. Every string, number and boolean under such a key is replaced, at
 * any depth (objects and arrays keep their structure); `null` and all other
 * text stay byte for byte. Unterminated strings run to the end of the text.
 *
 * @param text - Text holding JSON, possibly truncated or framed
 * @returns Text with credential values replaced by `"[redacted]"`; the text
 *   unchanged when there were none
 */
function redactJsonText(text: string): string {
  const scan: JsonScan = { text, parts: [], copied: 0, containers: [false], key: undefined };
  let index = 0;
  while (index < text.length) index = scanToken(scan, index);
  if (scan.parts.length === 0) return text;
  scan.parts.push(text.slice(scan.copied));
  return scan.parts.join('');
}

/**
 * Read the token at an index: a string, a bracket, a comma, a number or a
 * word; any other character is skipped.
 *
 * @param scan - Scan state
 * @param index - Index of the token's first character
 * @returns Index after the token
 */
function scanToken(scan: JsonScan, index: number): number {
  const char = scan.text[index];
  if (char === '"') return scanString(scan, index);
  if (char === '{' || char === '[') {
    scan.containers.push(takeValue(scan));
  } else if (char === '}' || char === ']') {
    if (scan.containers.length > 1) scan.containers.pop();
    scan.key = undefined;
  } else if (char === ',') {
    scan.key = undefined;
  } else {
    return scanLiteral(scan, index);
  }
  return index + 1;
}

/**
 * Read a string: a key (followed by `:`) sets whether the next value is
 * sensitive; a value under a credential name is replaced.
 *
 * @param scan - Scan state
 * @param start - Index of the opening quote
 * @returns Index after the closing quote, or the text length when there is none
 */
function scanString(scan: JsonScan, start: number): number {
  const end = stringEnd(scan.text, start);
  if (isFollowedByColon(scan.text, end)) {
    scan.key = isSensitiveField(keyName(scan.text, start, end));
  } else if (takeValue(scan)) {
    replaceValue(scan, start, end);
  }
  return end;
}

/**
 * Read a number or a word; a number, `true` or `false` under a credential
 * name is replaced. Other words are not values.
 *
 * @param scan - Scan state
 * @param index - Index of the character
 * @returns Index after the number or word, or after the character
 */
function scanLiteral(scan: JsonScan, index: number): number {
  NUMBER.lastIndex = index;
  WORD.lastIndex = index;
  const number = NUMBER.exec(scan.text)?.[0];
  const word = number === undefined ? WORD.exec(scan.text)?.[0] : undefined;
  const literal = number ?? word;
  if (literal === undefined) return index + 1;
  const end = index + literal.length;
  if (word !== undefined && word !== 'true' && word !== 'false' && word !== 'null') return end;
  if (takeValue(scan) && word !== 'null') replaceValue(scan, index, end);
  return end;
}

/**
 * Whether the value being read is under a credential name; consumes the key.
 *
 * @param scan - Scan state
 * @returns True when its key or an enclosing object or array names a credential
 */
function takeValue(scan: JsonScan): boolean {
  const sensitive = scan.key === true || scan.containers[scan.containers.length - 1] === true;
  scan.key = undefined;
  return sensitive;
}

/**
 * Write `"[redacted]"` instead of the text between two indices.
 *
 * @param scan - Scan state
 * @param start - Index of the value's first character
 * @param end - Index after the value
 */
function replaceValue(scan: JsonScan, start: number, end: number): void {
  scan.parts.push(scan.text.slice(scan.copied, start), REDACTED_STRING);
  scan.copied = end;
}

/**
 * End of a JSON string. Each quote looks back only over the backslashes
 * since the previous quote, so the search stays linear.
 *
 * @param text - Text
 * @param start - Index of the opening quote
 * @returns Index after the closing quote, or the text length when unterminated
 */
function stringEnd(text: string, start: number): number {
  let from = start + 1;
  for (;;) {
    const quote = text.indexOf('"', from);
    if (quote === -1) return text.length;
    let backslashes = 0;
    while (text[quote - 1 - backslashes] === '\\' && quote - 1 - backslashes > start) {
      backslashes++;
    }
    if (backslashes % 2 === 0) return quote + 1;
    from = quote + 1;
  }
}

/**
 * Whether the next character after whitespace is a colon.
 *
 * @param text - Text
 * @param index - Index to look from
 * @returns True when a key ends at the index
 */
function isFollowedByColon(text: string, index: number): boolean {
  let next = index;
  while (next < text.length && ' \t\n\r'.includes(text.charAt(next))) next++;
  return text[next] === ':';
}

/**
 * Name of a key, with JSON escapes decoded.
 *
 * @param text - Text
 * @param start - Index of the opening quote
 * @param end - Index after the closing quote
 * @returns Decoded name, or the raw name when its escapes are not valid
 */
function keyName(text: string, start: number, end: number): string {
  const raw = text.slice(start + 1, end - 1);
  if (!raw.includes('\\')) return raw;
  try {
    return JSON.parse(text.slice(start, end)) as string;
  } catch (error) {
    log.debug(`Key not decodable: ${getErrorMessage(error)}`);
    return raw;
  }
}
