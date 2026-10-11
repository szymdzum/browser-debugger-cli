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
  return withoutNestedUserInfo(shown);
}

/** A `blob:` URL, which wraps the URL of the page that made it */
const BLOB_URL = /^blob:/i;

/** The user info of a URL written inside a query or fragment value */
const NESTED_USER_INFO = /((?:[a-z][a-z\d+.-]*:)?\/\/)[^/?#]*@/i;

/**
 * A query or fragment value without the user info of a URL it holds, as
 * written or percent-encoded.
 *
 * @param value - Parameter value as written
 * @returns The value, user info removed
 */
function valueWithoutUserInfo(value: string): string {
  const raw = value.replace(NESTED_USER_INFO, '$1');
  if (raw !== value) return raw;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return value;
  }
  if (decoded === value) return value;
  const stripped = decoded.replace(NESTED_USER_INFO, '$1');
  return stripped === decoded ? value : encodeURIComponent(stripped);
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
