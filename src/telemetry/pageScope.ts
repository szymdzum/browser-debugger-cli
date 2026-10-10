/**
 * Which page load an entry (request, console message) belongs to, by its
 * navigation id. Ids go on across tabs (`bdg page switch` starts the next
 * one), so an entry of another tab before a switch counts as an earlier page.
 */

/** Something recorded during a page load */
interface PageEntry {
  navigationId?: number | undefined;
}

/**
 * Whether an entry was recorded on an earlier page load than the current one
 * (or on another tab before a switch). Entries without a navigation id
 * count as current.
 *
 * @param entry - Request or console message
 * @param currentNavigationId - Navigation id of the page currently loaded
 * @returns True for an entry of a previous page
 */
export function isPreviousPage(entry: PageEntry, currentNavigationId: number | undefined): boolean {
  return (
    currentNavigationId !== undefined &&
    entry.navigationId !== undefined &&
    entry.navigationId < currentNavigationId
  );
}

/**
 * The current page's navigation id: the session's when known, else the
 * latest among the entries.
 *
 * @param entries - Requests or console messages
 * @param currentNavigationId - The session's current navigation id, if known
 * @returns Navigation id, or undefined when neither has one
 */
export function currentNavigationOf(
  entries: PageEntry[],
  currentNavigationId?: number
): number | undefined {
  if (currentNavigationId !== undefined) return currentNavigationId;
  const ids = entries.flatMap((entry) =>
    entry.navigationId === undefined ? [] : [entry.navigationId]
  );
  return ids.length > 0 ? Math.max(...ids) : undefined;
}
