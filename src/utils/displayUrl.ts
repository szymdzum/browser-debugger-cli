/**
 * Page URLs as every output and `daemon.log` show them (#623): the user info
 * (`user:pass@`) removed whole, also from a URL nested in a query or
 * fragment value (`?next=http://u:p@x/`, raw or percent-encoded) and from
 * the URL a `blob:` URL wraps; secret-named query and fragment parameters
 * masked as {@link MASKED_VALUE}, by the HAR sanitiser's rule
 * (`isSensitiveParam`: secret field names plus `code`, `sig` and `key`); the
 * rest byte for byte. `--include-sensitive` shows the parameters; the user
 * info is removed with or without it (`details network --include-sensitive`
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
  const scrubbed = withoutNestedUserInfo(shown);
  return CONTENT_SCHEME.test(scrubbed) ? scrubbed : scrubbed.replace(USER_INFO_SEGMENT, '$1');
}

/** Schemes whose URLs carry content (a script, a document), not an address */
const CONTENT_SCHEME = /^(?:about|data|javascript|mailto|vbscript):/i;

/**
 * A `user:password@` anywhere in a URL that is not its authority (#757):
 * after `//`, `///` or a scheme without slashes (`http:///u:p@h`,
 * `https:/u:p@h`, which the URL parser reads as a path) or in a query
 * value (`?next=u:p@h`), raw or percent-encoded (`%3A`, `%40`). A segment
 * (between `/`, `?`, `#`, `&`, `=` or `;`) holding a `:` up to its last `@`.
 */
const USER_INFO_SEGMENT = /(^|[/?#&=;])[^/?#&=;\s]*?(?::|%3A)[^/?#&=;\s]*(?:@|%40)/gi;

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
