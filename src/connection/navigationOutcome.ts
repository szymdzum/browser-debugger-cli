/**
 * What a `Page.navigate` answer means for the page (#860): one classifier for
 * `bdg URL` and `page navigate`.
 */

/**
 * How a navigation ended: a document loaded, no document (a download or 204),
 * Chrome's certificate warning (a success the user can go through, reported
 * with a warning), or Chrome's error page
 */
export type NavigationOutcome = 'loaded' | 'not-a-page' | 'certificate' | 'failed';

/** Chrome's error for an aborted request: a download, a 204, or a redirect it refused (#890) */
export const ABORTED_ERROR = 'net::ERR_ABORTED';

/**
 * Chrome network errors that still leave a page worth inspecting; every other
 * one ends on Chrome's error page. `ERR_HTTP_RESPONSE_CODE_FAILURE`: an HTTP
 * error status with an empty body (Chrome shows its own page for the status);
 * `ERR_ABORTED`: a download, or a 204 that keeps the previous page;
 * `ERR_CERT_*` (Chrome's -200 range): the certificate interstitial, which the
 * user can go through.
 */
const PAGE_KEPT_ERRORS: ReadonlySet<string> = new Set([
  'net::ERR_HTTP_RESPONSE_CODE_FAILURE',
  ABORTED_ERROR,
]);

/** Certificate errors (Chrome's -200 range): the page is Chrome's certificate warning */
const CERTIFICATE_ERROR = /^net::ERR_CERT_[A-Z_]+$/;

/**
 * Classify Chrome's answer to `Page.navigate` (or the main document's
 * `Network.loadingFailed` error).
 *
 * @param errorText - Chrome network error, e.g. `net::ERR_CONNECTION_REFUSED`
 * @param loaderId - Loader of the new document, when Chrome named one
 * @returns How the navigation ended
 */
export function navigationOutcome(errorText?: string, loaderId?: string): NavigationOutcome {
  if (!errorText) return 'loaded';
  if (errorText === ABORTED_ERROR && !loaderId) return 'not-a-page';
  if (CERTIFICATE_ERROR.test(errorText)) return 'certificate';
  return PAGE_KEPT_ERRORS.has(errorText) ? 'loaded' : 'failed';
}
