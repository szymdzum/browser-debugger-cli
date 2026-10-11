/**
 * Page URLs as every output and `daemon.log` show them (#623): the user info
 * (`user:pass@`) removed whole and secret-named query and fragment
 * parameters masked as {@link MASKED_VALUE}, by the HAR sanitiser's rule
 * (`isSensitiveParam`: secret field names plus `code`, `sig` and `key`), the
 * rest byte for byte. `--include-sensitive` shows the parameters; the user
 * info is never shown (`details network --include-sensitive` has the full
 * request).
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
  return includeSensitive ? removeUrlUserInfo(url) : redactUrl(url, MASKED_VALUE);
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
