/**
 * Cookies Chrome blocked on a request, from the ExtraInfo events:
 * `responseReceivedExtraInfo.blockedCookies` (a `Set-Cookie` that was not
 * stored) and `requestWillBeSentExtraInfo.associatedCookies` with
 * `blockedReasons` (a stored cookie left out of the request).
 *
 * Only names and reasons are kept, never values, and at most
 * {@link MAX_BLOCKED_COOKIES} per request: an event is cut to that size as
 * soon as it arrives (a {@link BlockedCookieBatch}), before it waits for its
 * request. Cookies set through `document.cookie` involve no request; Chrome
 * Issues cover those (issues.ts).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import {
  BLOCKED_COOKIE_PREVIEW_NAMES,
  MAX_BLOCKED_COOKIES,
  MAX_BLOCKED_COOKIE_NAME_LENGTH,
  MAX_OMITTED_COOKIE_KEYS,
} from '@/constants.js';
import type { BlockedCookie, BlockedCookieSummary, NetworkRequest } from '@/types.js';
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
 * The blocked cookies of one ExtraInfo event, cut to the per-request bound.
 */
export interface BlockedCookieBatch {
  /** The first {@link MAX_BLOCKED_COOKIES} distinct entries */
  cookies: BlockedCookie[];
  /** Keys ({@link cookieKey}) of the next {@link MAX_OMITTED_COOKIE_KEYS} distinct entries */
  omittedKeys: string[];
  /** Distinct entries past those, counted only */
  omittedUntracked: number;
  /** Every kind among the entries not in `cookies` */
  omittedKinds: BlockedCookie['kind'][];
  /** Every reason among the entries not in `cookies` */
  omittedReasons: string[];
}

/** Blocked cookies of a request past the bound: what is known about them */
interface OmittedCookies {
  /** Keys already counted (at most {@link MAX_OMITTED_COOKIE_KEYS}) */
  keys: Set<string>;
  kinds: Set<BlockedCookie['kind']>;
  reasons: Set<string>;
}

/** Omitted blocked cookies per request (only requests past the bound have an entry) */
const omittedByRequest = new WeakMap<NetworkRequest, OmittedCookies>();

/**
 * A key telling blocked cookie entries apart.
 *
 * @param cookie - Entry
 * @returns Kind, reasons and name
 */
function cookieKey(cookie: BlockedCookie): string {
  return `${cookie.kind}\u0000${cookie.reasons.join(',')}\u0000${cookie.name}`;
}

/**
 * Cut the blocked cookies of one event to the per-request bound, dropping
 * repeats.
 *
 * @param cookies - Entries of the event
 * @returns Batch holding at most {@link MAX_BLOCKED_COOKIES} entries
 */
export function limitBlockedCookies(cookies: BlockedCookie[]): BlockedCookieBatch {
  const batch: BlockedCookieBatch = {
    cookies: [],
    omittedKeys: [],
    omittedUntracked: 0,
    omittedKinds: [],
    omittedReasons: [],
  };
  const seen = new Set<string>();
  const kinds = new Set<BlockedCookie['kind']>();
  const reasons = new Set<string>();
  for (const cookie of cookies) {
    const key = cookieKey(cookie);
    if (seen.has(key)) continue;
    seen.add(key);
    if (batch.cookies.length < MAX_BLOCKED_COOKIES) {
      batch.cookies.push(cookie);
      continue;
    }
    kinds.add(cookie.kind);
    cookie.reasons.forEach((reason) => reasons.add(reason));
    if (batch.omittedKeys.length < MAX_OMITTED_COOKIE_KEYS) batch.omittedKeys.push(key);
    else batch.omittedUntracked++;
  }
  batch.omittedKinds = [...kinds];
  batch.omittedReasons = [...reasons];
  return batch;
}

/**
 * `Set-Cookie`s of a response that Chrome did not store.
 *
 * @param blocked - `responseReceivedExtraInfo.blockedCookies`
 * @returns Entries of kind `set-rejected`, cut to the bound
 */
export function blockedSetCookies(
  blocked: Protocol.Network.BlockedSetCookieWithReason[] | undefined
): BlockedCookieBatch {
  return limitBlockedCookies(
    (blocked ?? [])
      .filter((cookie) => (cookie.blockedReasons ?? []).length > 0)
      .map((cookie) =>
        entry(cookie.cookie?.name ?? cookieLineName(cookie.cookieLine), 'set-rejected', [
          ...cookie.blockedReasons,
        ])
      )
  );
}

/**
 * Stored cookies Chrome left out of a request, except those that do not
 * apply to its URL ({@link NOT_APPLICABLE_REASONS}).
 *
 * @param associated - `requestWillBeSentExtraInfo.associatedCookies`
 * @returns Entries of kind `not-sent`, cut to the bound
 */
export function blockedAssociatedCookies(
  associated: Protocol.Network.AssociatedCookie[] | undefined
): BlockedCookieBatch {
  return limitBlockedCookies(
    (associated ?? [])
      .filter(
        ({ blockedReasons = [] }) =>
          blockedReasons.length > 0 &&
          !blockedReasons.some((reason) => NOT_APPLICABLE_REASONS.has(reason))
      )
      .map(({ cookie, blockedReasons }) => entry(cookie.name, 'not-sent', [...blockedReasons]))
  );
}

/**
 * What is known about a request's blocked cookies past the bound.
 *
 * @param request - Request
 * @returns Its entry, created on first use
 */
function omittedOf(request: NetworkRequest): OmittedCookies {
  let omitted = omittedByRequest.get(request);
  if (!omitted) {
    omitted = { keys: new Set(), kinds: new Set(), reasons: new Set() };
    omittedByRequest.set(request, omitted);
  }
  return omitted;
}

/**
 * Count a blocked cookie not kept, once per key while keys are remembered.
 *
 * @param request - Request
 * @param key - The cookie's key
 */
function countOmitted(request: NetworkRequest, key: string): void {
  const { keys } = omittedOf(request);
  if (keys.has(key)) return;
  if (keys.size < MAX_OMITTED_COOKIE_KEYS) keys.add(key);
  request.blockedCookiesOmitted = (request.blockedCookiesOmitted ?? 0) + 1;
}

/**
 * Note the kinds and reasons of blocked cookies not kept.
 *
 * @param request - Request
 * @param kinds - Kinds
 * @param reasons - Reasons
 */
function noteOmitted(
  request: NetworkRequest,
  kinds: BlockedCookie['kind'][],
  reasons: string[]
): void {
  if (kinds.length === 0 && reasons.length === 0) return;
  const omitted = omittedOf(request);
  kinds.forEach((kind) => omitted.kinds.add(kind));
  reasons.forEach((reason) => omitted.reasons.add(reason));
}

/**
 * Add an event's blocked cookies to a request, once each (Chrome may repeat
 * an event), keeping at most {@link MAX_BLOCKED_COOKIES} and counting the
 * rest in `blockedCookiesOmitted`.
 *
 * @param request - Request to update
 * @param batch - Entries from one ExtraInfo event
 */
export function addBlockedCookies(request: NetworkRequest, batch: BlockedCookieBatch): void {
  const kept = request.blockedCookies ?? [];
  const keptKeys = new Set(kept.map(cookieKey));
  for (const cookie of batch.cookies) {
    const key = cookieKey(cookie);
    if (keptKeys.has(key)) continue;
    if (kept.length < MAX_BLOCKED_COOKIES) {
      kept.push(cookie);
      keptKeys.add(key);
    } else {
      noteOmitted(request, [cookie.kind], cookie.reasons);
      countOmitted(request, key);
    }
  }
  batch.omittedKeys
    .filter((key) => !keptKeys.has(key))
    .forEach((key) => countOmitted(request, key));
  if (batch.omittedUntracked > 0) {
    request.blockedCookiesOmitted = (request.blockedCookiesOmitted ?? 0) + batch.omittedUntracked;
  }
  noteOmitted(request, batch.omittedKinds, batch.omittedReasons);
  if (kept.length > 0) request.blockedCookies = kept;
}

/**
 * A request's blocked cookies in short, for `network list` and `peek`.
 *
 * @param request - Captured request
 * @returns Count, every kind and reason, the first names; undefined when none
 */
export function summarizeBlockedCookies(request: NetworkRequest): BlockedCookieSummary | undefined {
  const kept = request.blockedCookies ?? [];
  const count = kept.length + (request.blockedCookiesOmitted ?? 0);
  if (count === 0) return undefined;
  const omitted = omittedByRequest.get(request);
  return {
    count,
    kinds: [...new Set([...kept.map((cookie) => cookie.kind), ...(omitted?.kinds ?? [])])],
    reasons: [
      ...new Set([...kept.flatMap((cookie) => cookie.reasons), ...(omitted?.reasons ?? [])]),
    ],
    names: kept.slice(0, BLOCKED_COOKIE_PREVIEW_NAMES).map((cookie) => cookie.name),
  };
}
