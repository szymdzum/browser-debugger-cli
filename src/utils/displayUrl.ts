/**
 * Page URLs as every output and `daemon.log` show them (#623): the user info
 * (`user:pass@`) removed whole, also from a URL nested in a query or
 * fragment value (`?next=http://u:p@x/`, raw or percent-encoded) and from
 * the URL a `blob:` URL wraps; secret-named query and fragment parameters
 * masked as {@link MASKED_VALUE}, by the HAR sanitiser's rule
 * (`isSensitiveParam`: secret field names plus `code`, `sig` and `key`); the
 * rest byte for byte. `--include-sensitive` shows the parameters; the user
 * info is removed with or without it (`network details --include-sensitive`
 * has the full request).
 */

import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import { redactUrl, removeUrlUserInfo } from '@/telemetry/har/sanitize.js';

/**
 * A URL as bdg shows it.
 *
 * @param url - URL as Chrome reports it
 * @param includeSensitive - Whether `--include-sensitive` was given (the
 *   query and fragment parameters are then shown; the user info is not)
 * @returns The URL to show
 */
export function displayUrl(url: string, includeSensitive = false): string {
  if (BLOB_URL.test(url)) return `blob:${displayUrl(url.slice('blob:'.length), includeSensitive)}`;
  const shown = includeSensitive ? removeUrlUserInfo(url) : redactUrl(url, MASKED_VALUE);
  return withoutAuthorityUserInfo(withoutNestedUserInfo(shown));
}

/** Schemes whose URLs carry content (a script, a document), not an address */
const CONTENT_SCHEME = /^(?:about|data|javascript|mailto|vbscript):/i;

/** The scheme and slashes a URL starts with (`http://`, `http:`, `////`), sticky */
const LEADING_SCHEME = /(?:[a-z][a-z\d+.-]*:)?\/*/iy;

/** A further scheme with slashes after the first (`http://https:/…`), sticky */
const FURTHER_SCHEME = /[a-z][a-z\d+.-]*:\/+/iy;

/**
 * The end of a sticky match at a position.
 *
 * @param pattern - Sticky pattern
 * @param text - Text to match
 * @param from - Position the match must start at
 * @returns Position after the match, or `from` without one
 */
function stickyEnd(pattern: RegExp, text: string, from: number): number {
  pattern.lastIndex = from;
  return pattern.test(text) ? pattern.lastIndex : from;
}

/**
 * A URL without the user info where its authority would be (#757): after the
 * scheme and any run of slashes, also when the parser reads it as a path
 * (`http:////u:p@h`, `https:/u:p@h`, `http:u:p@h`) or a typed scheme follows
 * the one bdg added (`http://https:/u:p@h`): everything up to the last `@`
 * before the next `/`, `?` or `#`. Paths and query values are left alone.
 * Scanned by index, linear in the URL's length.
 *
 * @param url - URL
 * @returns The URL, that user info removed
 */
function withoutAuthorityUserInfo(url: string): string {
  if (CONTENT_SCHEME.test(url)) return url;
  let start = stickyEnd(LEADING_SCHEME, url, 0);
  for (let next = stickyEnd(FURTHER_SCHEME, url, start); next > start;) {
    start = next;
    next = stickyEnd(FURTHER_SCHEME, url, start);
  }
  const end = url.slice(start).search(/[/?#]/);
  const authority = end === -1 ? url.slice(start) : url.slice(start, start + end);
  const at = authority.lastIndexOf('@');
  return at === -1 ? url : url.slice(0, start) + url.slice(start + at + 1);
}

/** A `blob:` URL, which wraps the URL of the page that made it */
const BLOB_URL = /^blob:/i;

/**
 * The user info of a URL that a query or fragment value is (`http://u:p@x/`
 * or `//u:p@x/` at its start), written raw or percent-encoded (`%3A`,
 * `%2F`, `%40`): everything after the `scheme://` up to the last `@`
 * before the path, query or fragment starts. Matching the encoded form in
 * place keeps every other character as written.
 */
const NESTED_USER_INFO =
  /^((?:[a-z][a-z\d+.-]*(?::|%3A))?(?:\/|%2F){2})(?:(?!%2F|%3F|%23|[/?#])[\s\S])*(?:@|%40)/i;

/**
 * A query or fragment value without the user info of the URL it holds, as
 * written or percent-encoded.
 *
 * @param value - Parameter value as written
 * @returns The value, user info removed, otherwise byte for byte
 */
function valueWithoutUserInfo(value: string): string {
  return value.replace(NESTED_USER_INFO, '$1');
}

/**
 * The parameters of a query or fragment with the user info of nested URLs
 * removed from their values; names and separators as written.
 *
 * @param pairs - Query or fragment without its `?` or `#`
 * @returns The pairs, values without user info
 */
function pairsWithoutUserInfo(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return valueWithoutUserInfo(pair);
      return `${pair.slice(0, eq + 1)}${valueWithoutUserInfo(pair.slice(eq + 1))}`;
    })
    .join('&');
}

/**
 * A URL with the user info of URLs nested in its query and fragment values
 * removed.
 *
 * @param url - URL without its own user info
 * @returns The URL, nested user info removed
 */
function withoutNestedUserInfo(url: string): string {
  const hash = url.indexOf('#');
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : `#${pairsWithoutUserInfo(url.slice(hash + 1))}`;
  const question = beforeHash.indexOf('?');
  if (question === -1) return beforeHash + fragment;
  return `${beforeHash.slice(0, question)}?${pairsWithoutUserInfo(beforeHash.slice(question + 1))}${fragment}`;
}

/**
 * Items with their `url` as bdg shows it ({@link displayUrl}).
 *
 * @param items - Items with a URL
 * @param includeSensitive - Whether `--include-sensitive` was given
 * @returns Copies of the items, their URLs as shown
 */
export function displayUrls<T extends { url: string }>(
  items: readonly T[],
  includeSensitive = false
): T[] {
  return items.map((item) => ({ ...item, url: displayUrl(item.url, includeSensitive) }));
}

/**
 * A tab switch note with the tab's URL as bdg shows it ({@link displayUrl}).
 *
 * @param tabSwitch - The session's latest move to another tab, if any
 * @param includeSensitive - Whether `--include-sensitive` was given
 * @returns The note to show, or undefined for none
 */
export function displayTabSwitch<T extends { tab: { url: string } }>(
  tabSwitch: T | undefined,
  includeSensitive = false
): T | undefined {
  if (!tabSwitch) return undefined;
  return {
    ...tabSwitch,
    tab: { ...tabSwitch.tab, url: displayUrl(tabSwitch.tab.url, includeSensitive) },
  };
}

/** Schemes whose URLs have no authority, so no user info to remove by position */
const OPAQUE_SCHEME = /^(?:about|blob|chrome|data|file|javascript|mailto|vbscript):/i;

/** A URL with a scheme and `//`, or a scheme-relative one */
const HIERARCHICAL_URL = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

/**
 * A URL as the user typed it, as bdg shows it in errors: {@link displayUrl}
 * also for input that does not parse. A scheme-less `host` (`localhost:3000`,
 * `user:pass@host:abc/p`) is read as `http://` would read it, so its user
 * info is removed by position (up to the last `@` before the path, query or
 * fragment) and its secret parameters masked; the `http://` is not shown.
 *
 * @param url - URL as typed
 * @returns The URL to show
 */
export function displayTypedUrl(url: string): string {
  if (HIERARCHICAL_URL.test(url) || OPAQUE_SCHEME.test(url)) return displayUrl(url);
  return displayUrl(`http://${url}`).slice('http://'.length);
}

/**
 * A URL that failed validation, as its error shows it: {@link displayTypedUrl}
 * and any `user:password@` in a path or query segment (`x?next=u:p@h`), raw
 * or percent-encoded, as such input may be anything (content schemes such
 * as `data:` excepted). Linear: each segment is scanned by index.
 *
 * @param url - URL as typed
 * @returns The URL to show
 */
export function displayRejectedUrl(url: string): string {
  if (CONTENT_SCHEME.test(url)) return displayUrl(url);
  return displayTypedUrl(url)
    .split(/([/?#&=;])/)
    .map(withoutSegmentUserInfo)
    .join('');
}

/**
 * A URL segment without a `user:password@` at its start: up to its last `@`
 * (or `%40`) when a `:` (or `%3A`) comes before it.
 *
 * @param segment - Text between `/`, `?`, `#`, `&`, `=` or `;`
 * @returns The segment, user info removed
 */
function withoutSegmentUserInfo(segment: string): string {
  const lower = segment.toLowerCase();
  const raw = lower.lastIndexOf('@');
  const encoded = lower.lastIndexOf('%40');
  const after = Math.max(raw === -1 ? -1 : raw + 1, encoded === -1 ? -1 : encoded + 3);
  if (after === -1) return segment;
  const colon = [lower.indexOf(':'), lower.indexOf('%3a')].filter((i) => i !== -1);
  return colon.some((i) => i < after) ? segment.slice(after) : segment;
}
