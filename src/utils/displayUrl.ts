/**
 * Page URLs as every output and `daemon.log` show them (#623).
 */

/**
 * A URL as bdg shows it.
 *
 * @param url - URL as Chrome reports it
 * @param includeSensitive - Whether `--include-sensitive` was given
 * @returns The URL to show
 */
export function displayUrl(url: string, includeSensitive = false): string {
  void includeSensitive;
  return url;
}

/**
 * Items with their `url` as bdg shows it.
 *
 * @param items - Items with a URL
 * @param includeSensitive - Whether `--include-sensitive` was given
 * @returns The items to show
 */
export function displayUrls<T extends { url: string }>(
  items: readonly T[],
  includeSensitive = false
): T[] {
  void includeSensitive;
  return [...items];
}
