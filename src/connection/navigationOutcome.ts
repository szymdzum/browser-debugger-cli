/**
 * What a `Page.navigate` answer means for the page (#860).
 */

/** How a navigation ended: a document loaded, no document (a download or 204), or Chrome's error page */
export type NavigationOutcome = 'loaded' | 'not-a-page' | 'failed';

/**
 * Classify Chrome's answer to `Page.navigate` (or the main document's
 * `Network.loadingFailed` error).
 *
 * @param errorText - Chrome network error, e.g. `net::ERR_CONNECTION_REFUSED`
 * @param loaderId - Loader of the new document, when Chrome named one
 * @returns How the navigation ended
 */
export function navigationOutcome(errorText?: string, loaderId?: string): NavigationOutcome {
  void errorText;
  void loaderId;
  throw new Error('not implemented');
}
