/**
 * Credential redaction in request and response bodies, WebSocket text
 * messages and `name=value` lists, for sanitized HAR exports (see sanitize.ts)
 * and the masked output of `details network` (networkMasking.ts). Each
 * replaces a credential value with a placeholder it is given
 * (`[redacted]` in a HAR, `••••` on screen).
 *
 * Matching is by field name only (`isSensitiveName`, the rule DOM masking
 * shares), so it over-redacts: any primitive whose name looks like a
 * credential (`tokenCount: 5`) is replaced too.
 *
 * JSON is never parsed and re-serialized: a single linear scan replaces the
 * credential values in place, so everything else (64-bit numbers, formatting,
 * duplicate keys, a BOM or `)]}'` prefix) stays byte for byte, and truncated
 * JSON, socket.io and SockJS packets, server-sent events, NDJSON and JSON
 * encoded in string values are covered too. JWTs are redacted under any name.
 *
 * Only JSON syntax is understood: single-quoted strings, unquoted keys,
 * JSONP and `name:value` header lines (STOMP `passcode:`) are not.
 *
 * In an HTML body the values of secret form controls are replaced
 * ({@link redactHtmlFields}, the rule `dom get --raw` applies on the page);
 * the rest of the HTML, inline scripts included, stays as captured.
 */

import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isSensitiveName } from '@/utils/sensitiveNames.js';

const log = createLogger('network');

/** Replaces a credential value */
export const REDACTED = '[redacted]';

/**
 * A body that is a form whatever its Content-Type: `k=v&k=v`, no whitespace,
 * not JSON (Rails-style names such as `user[password]` included)
 */
const FORM_BODY = /^(?!\[)[^\s=&{"]+=[^\s&]*(?:&[^\s=&]+=[^\s&]*)*$/;

/**
 * Text that holds JSON whatever its Content-Type: after an optional BOM,
 * XSSI guard (`)]}'`) and whitespace, an object or array (also after a
 * socket.io packet type such as `42`, `451-` or `42/chat,`, an Engine.io v3
 * length prefix such as `45:`, or a SockJS `a`/`c` frame type) or a
 * server-sent event field
 */
const JSON_LIKE_START =
  /^\uFEFF?(?:\)\]\}',?)?\s*(?:(?:\d+:)?(?:\d*-?(?:\/[^,]*,)?|[ac])[[{]|(?:data|event|id|retry):)/;

/** Content-Types whose bodies are scanned as JSON whatever they start with */
const JSON_MIME = /json|event-stream/i;

/**
 * Content-Types (without parameters) of base64 bodies decoded to look for
 * credentials: none, generic binary, JSON, form and server-sent events
 */
const DECODABLE_MIME =
  /^(?:application\/octet-stream|binary\/octet-stream|application\/x-www-form-urlencoded|text\/event-stream)?$|json/i;

/** Content-Types (without parameters) of HTML bodies, whose secret form-control values are masked */
const HTML_MIME = /^(?:text\/html|application\/xhtml\+xml)$/i;

/** Start of an `<input>` or `<textarea>` tag of any case (`$1` the name); a fresh copy per scan */
const CONTROL_START = /<(input|textarea)\b/gi;

/** End tag of a `<textarea>`, any case; a fresh copy per scan */
const TEXTAREA_END = /<\/textarea\s*>/gi;

/**
 * One attribute of a tag: `$1` the name; `$2`, `$3` or `$4` the value
 * (double-quoted, single-quoted or unquoted), none for a bare attribute
 */
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** An `autocomplete` token that names a card, one-time code or password field */
const SECRET_AUTOCOMPLETE = /(^|\s)(cc-[a-z-]+|one-time-code|current-password|new-password)(\s|$)/i;

/**
 * An auth scheme (any case, as RFC 7235 allows) followed on the same line by
 * a word of at least 6 token characters (`Bearer abc123`, `basic dXNlcjpw`);
 * {@link isTokenShaped} decides whether the word is a credential
 */
const SCHEME_CREDENTIALS = /\b(bearer|basic)([ \t]+)([\w.~+/=-]{6,})(?![\w.~+/=-])/gi;

/** A digit or a token symbol, which prose words do not have */
const TOKEN_SYMBOL = /[\d._~+/=-]/;

/** An uppercase letter after the first character (`dXNlcjpw`, `TOKEN`) */
const INNER_UPPERCASE = /.[A-Z]/;

/** A bare value (number, `true`, `false`, `null`) or word, up to the next delimiter */
const BARE = /[^\s,:[\]{}"]+/y;

/** Character code of `.`, the JWT segment separator */
const DOT = 0x2e;

/** Levels of JSON encoded in string values that are decoded */
const MAX_ENCODED_DEPTH = 3;

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
  /** Index of the next line end at or after the last string start (cached) */
  lineEnd: number;
  /** Levels of string encoding around the text */
  depth: number;
  /** Text written instead of a credential (inside a JSON string for JWTs) */
  placeholder: string;
}

/**
 * An attribute of a form control, as parsed from its tag.
 */
interface ParsedAttribute {
  /** Name, lowercased */
  name: string;
  /** Value as written (entities kept); empty for a bare attribute */
  value: string;
  /** Index of the value's first character in the attribute text, when it has one */
  valueStart: number;
}

/**
 * State of a scan of HTML text.
 */
interface HtmlScan {
  /** Text scanned */
  text: string;
  /** Unchanged slices and replacements written so far */
  parts: string[];
  /** End of the text copied into `parts` */
  copied: number;
  /** Text written instead of each value */
  placeholder: string;
  /** Index from which no closing quote of each kind was found (none is found later either) */
  noQuoteFrom: Record<string, number>;
  /** Index from which no `</textarea>` was found */
  noTextareaEndFrom: number;
}

/**
 * Where a tag ends.
 */
interface TagEnd {
  /** Index of the closing `>`; none for a tag broken by a `<` or an unclosed quote */
  close?: number;
  /** Index the scan goes on from */
  resume: number;
}

/**
 * Run a redaction, replacing the whole text when it fails, so that a body
 * the sanitizer cannot handle is never exported as captured.
 *
 * @param text - Body or message text
 * @param redact - Redaction of the text
 * @param whole - Text written when the redaction throws
 * @returns Redacted text, or `whole`
 */
export function redactOrReplaceWhole(
  text: string,
  redact: (text: string) => string,
  whole = REDACTED
): string {
  try {
    return redact(text);
  } catch (error) {
    log.debug(`Body replaced whole, sanitizing failed: ${getErrorMessage(error)}`);
    return whole;
  }
}

/**
 * Replace every whole JWT (`eyJ` and three base64url segments, not part of a
 * longer word) in text. Scanned by hand: a regular expression overflows the
 * stack on a word of millions of characters.
 *
 * @param text - Text
 * @param replacement - Text written instead of each JWT
 * @returns Text with JWTs replaced; the text unchanged when it has none
 */
export function redactJwts(text: string, replacement: string): string {
  if (!text.includes('eyJ')) return text;
  const parts: string[] = [];
  let copied = 0;
  let at = text.indexOf('eyJ');
  while (at !== -1) {
    const end = isJwtBoundary(text, at - 1) ? jwtEnd(text, at) : undefined;
    if (end !== undefined && isJwtBoundary(text, end)) {
      parts.push(text.slice(copied, at), replacement);
      copied = end;
    }
    at = text.indexOf('eyJ', Math.max(at + 3, copied));
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(copied));
  return parts.join('');
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
      if (eq === -1) return pair;
      if (isSensitive(decodeName(pair.slice(0, eq)))) return `${pair.slice(0, eq)}=${replacement}`;
      const value = pair.slice(eq + 1);
      const redacted = redactJwts(value, replacement);
      return redacted === value ? pair : `${pair.slice(0, eq + 1)}${redacted}`;
    })
    .join('&');
}

/**
 * Redact credential fields of a body or WebSocket text message: multipart
 * parts, form fields (by Content-Type or shape) and JSON fields at any depth.
 *
 * @param text - Body text
 * @param mimeType - Content-Type of the body (empty for a WebSocket message)
 * @param placeholder - Text written instead of each credential value
 * @returns Body with credential values replaced; the text unchanged when
 *   there were none or it is neither JSON, a form, multipart nor HTML
 */
export function redactBody(text: string, mimeType: string, placeholder = REDACTED): string {
  if (HTML_MIME.test(baseType(mimeType))) {
    return redactHtmlFields(redactJwts(text, placeholder), placeholder);
  }
  if (/multipart\/form-data/i.test(mimeType)) return redactMultipart(text, mimeType, placeholder);
  if (/x-www-form-urlencoded/i.test(mimeType)) {
    return redactPairs(text, isSensitiveName, placeholder);
  }
  if (JSON_LIKE_START.test(text)) return redactJsonText(text, 0, placeholder);
  if (FORM_BODY.test(text)) return redactPairs(text, isSensitiveName, placeholder);
  if (JSON_MIME.test(mimeType)) return redactJsonText(text, 0, placeholder);
  return redactJwts(text, placeholder);
}

/**
 * Replace the values of secret form controls in an HTML body (#634): every
 * non-empty `value` attribute of an `<input>` that is `type=password` or
 * `type=hidden`, has a card, one-time code or password `autocomplete`, or
 * whose `name`, `id` or `autocomplete` is a secret name
 * ({@link isSensitiveName}, the rule `dom get --raw` applies on the page),
 * and the non-empty content of a `<textarea>` judged the same way. The rest
 * of the HTML, inline scripts included, stays byte for byte.
 *
 * The HTML is scanned as text, not parsed, in one linear pass: tags of any
 * case, attributes in any order, quoted (entities kept), single-quoted or
 * unquoted values, `>` inside quotes and tags split over lines are
 * understood. A tag broken by a `<` or an unclosed quote is not judged, and
 * the scan goes on from that `<` (a quote or end tag not found once is not
 * looked for again, so a hostile body of a million tag starts is still one
 * pass). A `<select>`'s options, and a control written inside a script
 * string or comment (masked too), are its limits.
 *
 * @param text - HTML text
 * @param placeholder - Text written instead of each value
 * @returns The HTML with those values replaced; the text unchanged when it
 *   has no secret control
 */
export function redactHtmlFields(text: string, placeholder = REDACTED): string {
  const scan: HtmlScan = {
    text,
    parts: [],
    copied: 0,
    placeholder,
    noQuoteFrom: { '"': Infinity, "'": Infinity },
    noTextareaEndFrom: Infinity,
  };
  const start = new RegExp(CONTROL_START.source, CONTROL_START.flags);
  let match = start.exec(text);
  while (match !== null) {
    const attributesStart = match.index + match[0].length;
    const isTextarea = (match[1] ?? '').toLowerCase() === 'textarea';
    start.lastIndex = scanControl(scan, attributesStart, isTextarea);
    match = start.exec(text);
  }
  if (scan.parts.length === 0) return text;
  scan.parts.push(text.slice(scan.copied));
  return scan.parts.join('');
}

/**
 * Judge one control whose tag starts at an index and replace its value(s).
 *
 * @param scan - Scan state
 * @param attributesStart - Index after the tag name
 * @param isTextarea - Whether it is a `<textarea>` (its content is the value)
 * @returns Index the scan goes on from
 */
function scanControl(scan: HtmlScan, attributesStart: number, isTextarea: boolean): number {
  const end = tagEnd(scan, attributesStart);
  if (end.close === undefined) return end.resume;
  const attributes = scan.text.slice(attributesStart, end.close);
  if (!isTextarea) {
    const redacted = redactInputValues(attributes, scan.placeholder);
    if (redacted !== undefined) replaceHtml(scan, attributesStart, end.close, redacted);
    return end.resume;
  }
  const contentStart = end.close + 1;
  const endTag = textareaEnd(scan, contentStart);
  if (endTag === undefined) return contentStart;
  if (endTag.index > contentStart && isSecretControl(parseAttributes(attributes))) {
    replaceHtml(scan, contentStart, endTag.index, scan.placeholder);
  }
  return endTag.index + endTag[0].length;
}

/**
 * Walk a tag's attributes to its closing `>`, honouring quotes.
 *
 * @param scan - Scan state
 * @param from - Index after the tag name
 * @returns The closing index, or where to go on from when the tag is broken
 */
function tagEnd(scan: HtmlScan, from: number): TagEnd {
  const { text } = scan;
  let index = from;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === '>') return { close: index, resume: index + 1 };
    if (char === '<') return { resume: index };
    if (char !== '"' && char !== "'") {
      index++;
      continue;
    }
    const closing =
      index + 1 >= (scan.noQuoteFrom[char] ?? Infinity) ? -1 : text.indexOf(char, index + 1);
    if (closing === -1) {
      scan.noQuoteFrom[char] = Math.min(scan.noQuoteFrom[char] ?? Infinity, index + 1);
      const next = text.indexOf('<', from);
      return { resume: next === -1 ? text.length : next };
    }
    index = closing + 1;
  }
  return { resume: text.length };
}

/**
 * The `</textarea>` end tag at or after an index.
 *
 * @param scan - Scan state
 * @param from - Index after the start tag
 * @returns Its match, or undefined when there is none
 */
function textareaEnd(scan: HtmlScan, from: number): RegExpExecArray | undefined {
  if (from >= scan.noTextareaEndFrom) return undefined;
  const end = new RegExp(TEXTAREA_END.source, TEXTAREA_END.flags);
  end.lastIndex = from;
  const match = end.exec(scan.text);
  if (match === null) scan.noTextareaEndFrom = from;
  return match ?? undefined;
}

/**
 * Write a replacement instead of the text between two indices.
 *
 * @param scan - Scan state
 * @param start - Index of the first character replaced
 * @param end - Index after the last
 * @param replacement - Text written instead
 */
function replaceHtml(scan: HtmlScan, start: number, end: number, replacement: string): void {
  scan.parts.push(scan.text.slice(scan.copied, start), replacement);
  scan.copied = end;
}

/**
 * Replace the non-empty `value` attributes of an `<input>` when the control
 * holds a secret.
 *
 * @param attributes - Attribute text of the tag
 * @param placeholder - Text written instead of each value
 * @returns The attribute text with its values replaced (quotes kept), or
 *   undefined when the control is not a secret or has no value
 */
function redactInputValues(attributes: string, placeholder: string): string | undefined {
  const parsed = parseAttributes(attributes);
  if (!isSecretControl(parsed)) return undefined;
  let redacted = attributes;
  let changed = false;
  for (const attribute of [...parsed].reverse()) {
    if (attribute.name !== 'value' || attribute.value === '') continue;
    const end = attribute.valueStart + attribute.value.length;
    redacted = `${redacted.slice(0, attribute.valueStart)}${placeholder}${redacted.slice(end)}`;
    changed = true;
  }
  return changed ? redacted : undefined;
}

/**
 * The media type of a Content-Type, without its parameters.
 *
 * @param mimeType - Content-Type as captured
 * @returns e.g. `text/html` for `text/html; charset=utf-8`
 */
function baseType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim() ?? '';
}

/**
 * Parse the attributes of a tag.
 *
 * @param attributes - Attribute text of the tag
 * @returns Attributes in order, names lowercased
 */
function parseAttributes(attributes: string): ParsedAttribute[] {
  const parsed: ParsedAttribute[] = [];
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const quoted = match[2] !== undefined || match[3] !== undefined;
    parsed.push({
      name: (match[1] ?? '').toLowerCase(),
      value,
      valueStart: match.index + match[0].length - value.length - (quoted ? 1 : 0),
    });
  }
  return parsed;
}

/**
 * Whether a form control holds a secret: by type, autocomplete, name or id
 * (the first of each attribute counts, as in HTML).
 *
 * @param attributes - Parsed attributes
 * @returns True for a password, hidden, card, one-time code or secret-named control
 */
function isSecretControl(attributes: ParsedAttribute[]): boolean {
  const first = (name: string): string =>
    attributes.find((attribute) => attribute.name === name)?.value ?? '';
  if (/^\s*(?:password|hidden)\s*$/i.test(first('type'))) return true;
  const autocomplete = first('autocomplete');
  if (SECRET_AUTOCOMPLETE.test(autocomplete)) return true;
  return isSensitiveName([first('name'), first('id'), autocomplete].join(' '));
}

/**
 * Redact credential fields of a base64 body or binary WebSocket message that
 * may be text: one with no, a generic binary, a JSON, a form or an
 * event-stream Content-Type that decodes as UTF-8.
 *
 * @param base64 - Body as base64
 * @param mimeType - Content-Type of the body
 * @param placeholder - Text written instead of each credential value
 * @returns The redacted body re-encoded, or the input unchanged when it was
 *   not decodable text or held no credentials
 */
export function redactBase64Body(base64: string, mimeType: string, placeholder = REDACTED): string {
  if (!DECODABLE_MIME.test(baseType(mimeType))) return base64;
  return redactBase64Text(base64, (text) => redactBody(text, mimeType, placeholder));
}

/**
 * Redact credential fields of a WebSocket text message: as a body
 * ({@link redactBody}), and in a message that is neither JSON nor a form,
 * a token-shaped credential after a `Bearer` or `Basic` scheme of any case
 * on the same line too (`bearer abc123` is written `bearer [redacted]`;
 * `Basic information` stays); the rest stays byte for byte.
 *
 * @param text - Message text
 * @param placeholder - Text written instead of each credential value
 * @returns Message with credential values replaced
 */
export function redactMessage(text: string, placeholder = REDACTED): string {
  const redacted = redactBody(text, '', placeholder);
  if (JSON_LIKE_START.test(text) || FORM_BODY.test(text)) return redacted;
  return redacted.replace(
    SCHEME_CREDENTIALS,
    (match, scheme: string, space: string, value: string) =>
      isTokenShaped(value) ? `${scheme}${space}${placeholder}` : match
  );
}

/**
 * Whether a word after an auth scheme looks like a credential rather than
 * prose: it has a digit or symbol, or an uppercase letter after its first
 * character (base64). `Basic information` and `bearer of` are prose.
 *
 * @param value - Word after the scheme
 * @returns True for a token-shaped word
 */
function isTokenShaped(value: string): boolean {
  return TOKEN_SYMBOL.test(value) || INNER_UPPERCASE.test(value);
}

/**
 * Redact a binary WebSocket message that decodes as UTF-8 text, as a text
 * message ({@link redactMessage}).
 *
 * @param base64 - Message as base64
 * @param placeholder - Text written instead of each credential value
 * @returns The redacted message re-encoded, or the input unchanged when it
 *   was not text or held no credentials
 */
export function redactBase64Message(base64: string, placeholder = REDACTED): string {
  return redactBase64Text(base64, (text) => redactMessage(text, placeholder));
}

/**
 * Redact base64 data that decodes as UTF-8 text.
 *
 * @param base64 - Data as base64
 * @param redact - Redaction of the decoded text
 * @returns The redacted text re-encoded, or the input unchanged when it was
 *   not UTF-8 or the redaction changed nothing
 */
function redactBase64Text(base64: string, redact: (text: string) => string): string {
  let decoded: string;
  try {
    decoded = UTF8.decode(Buffer.from(base64, 'base64'));
  } catch (error) {
    log.debug(`Base64 body is not UTF-8: ${getErrorMessage(error)}`);
    return base64;
  }
  const redacted = redact(decoded);
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
 * @param placeholder - Text written instead of each credential value
 * @returns Body with credential part values replaced
 */
function redactMultipart(text: string, mimeType: string, placeholder: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(mimeType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return text;
  const delimiter = `--${boundary}`;
  return text
    .split(delimiter)
    .map((part) => redactPart(part, placeholder))
    .join(delimiter);
}

/**
 * Redact the value of one multipart part if its name holds a credential, or
 * the JWTs in it.
 *
 * @param part - Text between two boundary delimiters
 * @param placeholder - Text written instead of the value or each JWT
 * @returns The part, or the part with its value or JWTs replaced
 */
function redactPart(part: string, placeholder: string): string {
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd === -1) return part;
  const name = /;\s*name="([^"]*)"/i.exec(part.slice(0, headerEnd))?.[1];
  if (name === undefined || !isSensitiveName(name)) return redactJwts(part, placeholder);
  const valueEnd = part.endsWith('\r\n') ? part.length - 2 : part.length;
  return `${part.slice(0, headerEnd + 4)}${placeholder}${part.slice(valueEnd)}`;
}

/**
 * Replace the values under credential names in JSON-like text, in one linear
 * pass. Every string, number and boolean under such a key is replaced, at
 * any depth (objects and arrays keep their structure), and so is a JWT under
 * any key; `null` and all other text stay byte for byte. A string ends at
 * its closing quote or at the end of its line (JSON strings hold no raw line
 * breaks), so a stray quote hides nothing past its line.
 *
 * @param text - Text holding JSON, possibly truncated or framed
 * @param depth - Levels of string encoding around the text
 * @param placeholder - Text written (as a JSON string) instead of each credential value
 * @returns Text with credential values replaced by the placeholder string;
 *   the text unchanged when there were none
 */
function redactJsonText(text: string, depth: number, placeholder: string): string {
  const scan: JsonScan = {
    text,
    parts: [],
    copied: 0,
    containers: [false],
    key: undefined,
    lineEnd: -1,
    depth,
    placeholder,
  };
  let index = 0;
  while (index < text.length) index = scanToken(scan, index);
  if (scan.parts.length === 0) return text;
  scan.parts.push(text.slice(scan.copied));
  return scan.parts.join('');
}

/**
 * Read the token at an index: a string, a bracket, a comma or a bare value;
 * whitespace and colons are skipped.
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
    return scanBare(scan, index);
  }
  return index + 1;
}

/**
 * Read a string: a key (followed by `:`) sets whether the next value is
 * sensitive; a value under a credential name is replaced, JSON encoded in a
 * value is redacted and encoded again, and JWTs in other values are replaced.
 *
 * @param scan - Scan state
 * @param start - Index of the opening quote
 * @returns Index after the string
 */
function scanString(scan: JsonScan, start: number): number {
  const end = stringEnd(scan, start);
  if (isFollowedByColon(scan.text, end)) {
    scan.key = isSensitiveName(keyName(scan.text, start, end));
  } else if (takeValue(scan)) {
    replaceValue(scan, start, end, JSON.stringify(scan.placeholder));
  } else {
    const encoded = redactEncodedJson(scan, start, end);
    if (encoded === undefined) redactStringJwts(scan, start, end);
    else replaceValue(scan, start, end, encoded);
  }
  return end;
}

/**
 * Replace the whole JWTs in a string value, keeping the text around them.
 *
 * @param scan - Scan state
 * @param start - Index of the opening quote
 * @param end - Index after the string
 */
function redactStringJwts(scan: JsonScan, start: number, end: number): void {
  const contentEnd = end - 1 > start && scan.text[end - 1] === '"' ? end - 1 : end;
  const content = scan.text.slice(start + 1, contentEnd);
  const redacted = redactJwts(content, scan.placeholder);
  if (redacted !== content) replaceValue(scan, start + 1, contentEnd, redacted);
}

/**
 * Read a bare value or word up to the next delimiter; a number, `true`,
 * `false` or any bare text right after a credential key is replaced. Other
 * words are not values.
 *
 * @param scan - Scan state
 * @param index - Index of the character
 * @returns Index after the bare text, or after a whitespace or colon character
 */
function scanBare(scan: JsonScan, index: number): number {
  BARE.lastIndex = index;
  const bare = BARE.exec(scan.text)?.[0];
  if (bare === undefined) return index + 1;
  const end = index + bare.length;
  const isLiteral = /^[-\d]/.test(bare) || bare === 'true' || bare === 'false' || bare === 'null';
  if (!isLiteral && scan.key !== true) return end;
  if (takeValue(scan) && bare !== 'null') {
    replaceValue(scan, index, end, JSON.stringify(scan.placeholder));
  }
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
 * Write a replacement instead of the text between two indices.
 *
 * @param scan - Scan state
 * @param start - Index of the value's first character
 * @param end - Index after the value
 * @param replacement - Text written instead
 */
function replaceValue(scan: JsonScan, start: number, end: number, replacement: string): void {
  scan.parts.push(scan.text.slice(scan.copied, start), replacement);
  scan.copied = end;
}

/**
 * Whether the character at an index cannot be part of a JWT's word: outside
 * the text, or not a base64url character, `.` or `-`.
 *
 * @param text - Text
 * @param index - Index (may be -1 or the text length)
 * @returns True at a word boundary
 */
function isJwtBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  const code = text.charCodeAt(index);
  return !isBase64UrlCode(code) && code !== DOT;
}

/**
 * End of a JWT starting at an index: `eyJ` and at least 5 more base64url
 * characters, a dot, at least 5, a dot, and any number.
 *
 * @param text - Text
 * @param start - Index of `eyJ`
 * @returns Index after the third segment, or undefined when it is no JWT
 */
function jwtEnd(text: string, start: number): number | undefined {
  const first = segmentEnd(text, start + 3);
  if (first - start < 8 || text[first] !== '.') return undefined;
  const second = segmentEnd(text, first + 1);
  if (second - first - 1 < 5 || text[second] !== '.') return undefined;
  return segmentEnd(text, second + 1);
}

/**
 * End of a run of base64url characters.
 *
 * @param text - Text
 * @param from - Index to start at
 * @returns Index of the first other character, or the text length
 */
function segmentEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length && isBase64UrlCode(text.charCodeAt(index))) index++;
  return index;
}

/**
 * Whether a character code is a base64url character: `A-Z`, `a-z`, `0-9`,
 * `_` or `-`.
 *
 * @param code - UTF-16 code unit
 * @returns True for a base64url character
 */
function isBase64UrlCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x2d
  );
}

/**
 * Redact JSON encoded in a string value (a JSON payload, GraphQL variables,
 * a SockJS or socket.io message): decoded text that looks like JSON
 * ({@link JSON_LIKE_START}), up to {@link MAX_ENCODED_DEPTH} levels.
 *
 * @param scan - Scan state
 * @param start - Index of the opening quote
 * @param end - Index after the string
 * @returns The string encoded again with credentials redacted; undefined when
 *   it holds no JSON or no credentials, so it stays byte for byte
 */
function redactEncodedJson(scan: JsonScan, start: number, end: number): string | undefined {
  if (scan.depth >= MAX_ENCODED_DEPTH || end - start < 2 || scan.text[end - 1] !== '"') {
    return undefined;
  }
  if (!/[[{]/.test(scan.text.slice(start + 1, end - 1))) return undefined;
  let decoded: string;
  try {
    decoded = JSON.parse(scan.text.slice(start, end)) as string;
  } catch (error) {
    log.debug(`String value not decodable: ${getErrorMessage(error)}`);
    return undefined;
  }
  if (!JSON_LIKE_START.test(decoded)) return undefined;
  const redacted = redactJsonText(decoded, scan.depth + 1, scan.placeholder);
  return redacted === decoded ? undefined : JSON.stringify(redacted);
}

/**
 * End of a JSON string: its closing quote, or the end of its line. Each quote
 * looks back only over the backslashes since the previous quote, and the
 * line end is cached, so the search stays linear.
 *
 * @param scan - Scan state
 * @param start - Index of the opening quote
 * @returns Index after the closing quote, or of the line break (`\r\n` or
 *   `\n`) or text end when the line has none
 */
function stringEnd(scan: JsonScan, start: number): number {
  const { text } = scan;
  let from = start + 1;
  for (;;) {
    const quote = text.indexOf('"', from);
    const lineEnd = nextLineEnd(scan, from);
    if (quote === -1 || lineEnd < quote) {
      return lineEnd > from && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    }
    let backslashes = 0;
    while (text[quote - 1 - backslashes] === '\\' && quote - 1 - backslashes > start) {
      backslashes++;
    }
    if (backslashes % 2 === 0) return quote + 1;
    from = quote + 1;
  }
}

/**
 * Index of the next `\n` at or after an index, or the text length.
 *
 * @param scan - Scan state, whose cached line end is updated
 * @param from - Index to look from
 * @returns Index of the line break
 */
function nextLineEnd(scan: JsonScan, from: number): number {
  if (scan.lineEnd < from) {
    const lineEnd = scan.text.indexOf('\n', from);
    scan.lineEnd = lineEnd === -1 ? scan.text.length : lineEnd;
  }
  return scan.lineEnd;
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
