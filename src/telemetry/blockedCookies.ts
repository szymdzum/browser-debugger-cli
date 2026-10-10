/**
 * Cookies Chrome blocked on a request, from the ExtraInfo events:
 * `responseReceivedExtraInfo.blockedCookies` (a `Set-Cookie` that was not
 * stored) and `requestWillBeSentExtraInfo.associatedCookies` with
 * `blockedReasons` (a stored cookie left out of the request).
 *
 * Only names and reasons are kept, never values. Cookies set through
 * `document.cookie` involve no request; Chrome Issues cover those (issues.ts).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { MAX_BLOCKED_COOKIES, MAX_BLOCKED_COOKIE_NAME_LENGTH } from '@/constants.js';
import type { BlockedCookie, NetworkRequest } from '@/types.js';
import { truncateByLength } from '@/utils/strings.js';

/**
 * Reasons meaning a cookie does not apply to the request's URL, not that it
 * was blocked (a page has dozens of these for other domains and paths)
 */
const NOT_APPLICABLE_REASONS = new Set(['DomainMismatch', 'PathMismatch', 'NotOnPath']);

/**
 * The name of a `Set-Cookie` line, without its value.
 *
 * @param cookieLine - One cookie as it appeared in the header
 * @returns Name (empty when the line has no `=`, as the cookie then has no name)
 */
function cookieLineName(cookieLine: string): string {
  const pair = cookieLine.split(';', 1)[0] ?? '';
  const equals = pair.indexOf('=');
  return equals === -1 ? '' : pair.slice(0, equals).trim();
}

/**
 * A blocked cookie entry.
 *
 * @param name - Cookie name
 * @param kind - What was blocked
 * @param reasons - Chrome's reasons
 * @returns Entry with the name cut to {@link MAX_BLOCKED_COOKIE_NAME_LENGTH}
 */
function entry(name: string, kind: BlockedCookie['kind'], reasons: string[]): BlockedCookie {
  return { name: truncateByLength(name, MAX_BLOCKED_COOKIE_NAME_LENGTH), kind, reasons };
}

/**
 * `Set-Cookie`s of a response that Chrome did not store.
 *
 * @param blocked - `responseReceivedExtraInfo.blockedCookies`
 * @returns Entries of kind `set-rejected`
 */
export function blockedSetCookies(
  blocked: Protocol.Network.BlockedSetCookieWithReason[] | undefined
): BlockedCookie[] {
  return (blocked ?? [])
    .filter((cookie) => (cookie.blockedReasons ?? []).length > 0)
    .map((cookie) =>
      entry(cookie.cookie?.name ?? cookieLineName(cookie.cookieLine), 'set-rejected', [
        ...cookie.blockedReasons,
      ])
    );
}

/**
 * Stored cookies Chrome left out of a request, except those that do not
 * apply to its URL ({@link NOT_APPLICABLE_REASONS}).
 *
 * @param associated - `requestWillBeSentExtraInfo.associatedCookies`
 * @returns Entries of kind `not-sent`
 */
export function blockedAssociatedCookies(
  associated: Protocol.Network.AssociatedCookie[] | undefined
): BlockedCookie[] {
  return (associated ?? [])
    .filter(
      ({ blockedReasons = [] }) =>
        blockedReasons.length > 0 &&
        !blockedReasons.some((reason) => NOT_APPLICABLE_REASONS.has(reason))
    )
    .map(({ cookie, blockedReasons }) => entry(cookie.name, 'not-sent', [...blockedReasons]));
}

/**
 * Whether two entries describe the same blocked cookie.
 *
 * @param a - Entry
 * @param b - Entry
 * @returns True for the same name, kind and reasons
 */
function sameEntry(a: BlockedCookie, b: BlockedCookie): boolean {
  return a.kind === b.kind && a.name === b.name && a.reasons.join() === b.reasons.join();
}

/**
 * Add blocked cookies to a request, once each (Chrome may repeat an event),
 * keeping at most {@link MAX_BLOCKED_COOKIES} and counting the rest in
 * `blockedCookiesOmitted`.
 *
 * @param request - Request to update
 * @param cookies - Entries from one ExtraInfo event
 */
export function addBlockedCookies(request: NetworkRequest, cookies: BlockedCookie[]): void {
  for (const cookie of cookies) {
    const kept = (request.blockedCookies ??= []);
    if (kept.some((existing) => sameEntry(existing, cookie))) continue;
    if (kept.length < MAX_BLOCKED_COOKIES) kept.push(cookie);
    else request.blockedCookiesOmitted = (request.blockedCookiesOmitted ?? 0) + 1;
  }
}
