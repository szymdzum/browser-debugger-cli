/**
 * Network command messages (bdg network list)
 *
 * User-facing messages for the network list command output and formatting.
 */

import { MAX_BLOCKED_COOKIES, MAX_NETWORK_REQUESTS, MAX_TOTAL_BODY_BYTES } from '@/constants.js';
import type { BlockedCookie } from '@/types.js';
import { pluralize } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * A byte budget in whole megabytes.
 *
 * @param bytes - Budget
 * @returns e.g. `100 MB`
 */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Why a stored request or response body was replaced by a placeholder
 * (shown by `bdg details network <id>` as `requestBodyNotCaptured` or
 * `bodyNotCaptured`).
 *
 * @param budgetBytes - Total body budget of the session
 * @returns e.g. `evicted: total body budget (bdg keeps the newest 100 MB of request and response bodies)`
 */
export function bodyEvictedReason(budgetBytes: number): string {
  return `evicted: total body budget (bdg keeps the newest ${megabytes(budgetBytes)} of request and response bodies)`;
}

/**
 * Why a response body is missing when Chrome no longer had it
 * (`Network.getResponseBody` failed with "No resource with given identifier
 * found" or "No data found for resource with given identifier"), shown by
 * `bdg details network <id>` as `bodyNotCaptured` and in the HAR as the
 * content comment.
 *
 * @returns Reason text
 */
export function bodyGoneReason(): string {
  return 'Chrome no longer had the body (its network buffer evicted it, or the request was cancelled)';
}

/**
 * Why a response body is missing when `Network.getResponseBody` failed for
 * another reason (a CDP timeout, the connection closing mid-fetch).
 *
 * @param errorMessage - The error Chrome or the connection gave
 * @returns e.g. `Chrome did not return the body: CDP command timeout`
 */
export function bodyFetchFailedReason(errorMessage: string): string {
  return `Chrome did not return the body: ${errorMessage}`;
}

/** What a session's network capture let go at its limits */
export interface NetworkEvictionCounts {
  /** Oldest finished requests dropped at the request cap */
  requestsDropped: number;
  /** Oldest request and response bodies evicted at the body budget */
  bodiesEvicted: number;
}

/**
 * Note that the session dropped its oldest requests or evicted its oldest
 * request and response bodies at its limits.
 *
 * @param counts - Requests dropped and bodies evicted
 * @returns e.g. `⚠ 2000 older network requests were dropped: bdg keeps the newest 10000`;
 *   undefined when nothing was let go
 */
export function networkEvictedNote(counts: NetworkEvictionCounts): string | undefined {
  const { requestsDropped, bodiesEvicted } = counts;
  const requests = pluralize(requestsDropped, 'older network request');
  const bodies = pluralize(
    bodiesEvicted,
    'older request/response body',
    'older request/response bodies'
  );
  const budget = megabytes(MAX_TOTAL_BODY_BYTES);
  if (requestsDropped > 0 && bodiesEvicted > 0) {
    return `⚠ ${requests} dropped, ${bodies} evicted: bdg keeps the newest ${MAX_NETWORK_REQUESTS} requests and ${budget} of bodies`;
  }
  if (requestsDropped > 0) {
    return `⚠ ${requests} ${requestsDropped === 1 ? 'was' : 'were'} dropped: bdg keeps the newest ${MAX_NETWORK_REQUESTS}`;
  }
  if (bodiesEvicted > 0) {
    return `⚠ ${bodies} ${bodiesEvicted === 1 ? 'was' : 'were'} evicted: bdg keeps the newest ${budget} of bodies`;
  }
  return undefined;
}

/**
 * Generate message for following network output.
 *
 * @returns Status message for stderr
 */
export function followingNetworkMessage(): string {
  return 'Following network requests... (Ctrl+C to stop)';
}

/**
 * Generate message when stopping network follow mode.
 *
 * @returns Status message for stderr
 */
export function stoppedFollowingNetworkMessage(): string {
  return '\nStopped following network requests.';
}

/**
 * Note after a header value the server sent more than once.
 *
 * @param count - Times it was sent
 * @returns e.g. `(sent 2 times)`
 */
export function headerRepeatedNote(count: number): string {
  return `(sent ${count} times)`;
}

/** Mark after the URL of a `network list` row whose request had cookies blocked */
export const COOKIE_BLOCKED_MARK = '⚠ cookie blocked';

/** What each kind of blocked cookie means, as `details network` says it */
const BLOCKED_COOKIE_KINDS: Record<BlockedCookie['kind'], string> = {
  'set-rejected': 'set rejected',
  'not-sent': 'not sent',
};

/**
 * Why a cookie was blocked, for the `Blocked Cookies` block of `details network`.
 *
 * @param cookie - Blocked cookie
 * @returns e.g. `not sent: SchemefulSameSiteLax`, `set rejected: SyntaxError, UnknownError`
 */
export function blockedCookieReason(cookie: BlockedCookie): string {
  return `${BLOCKED_COOKIE_KINDS[cookie.kind]}: ${cookie.reasons.join(', ')}`;
}

/**
 * A blocked cookie's name as `details network` shows it.
 *
 * @param name - Cookie name
 * @returns The name, or `(no name)` for a Set-Cookie line without `=`
 */
export function blockedCookieName(name: string): string {
  return name === '' ? '(no name)' : name;
}

/**
 * Note under the `Blocked Cookies` block when some were not kept.
 *
 * @param omitted - Blocked cookies not kept
 * @returns e.g. `(+3 more not kept: bdg keeps 50 per request)`
 */
export function blockedCookiesOmittedNote(omitted: number): string {
  return `(+${omitted} more not kept: bdg keeps ${MAX_BLOCKED_COOKIES} per request)`;
}

/**
 * Note after a loopback remote address of a request to another host and
 * port: Chrome probably connected to a proxy on this machine, not the server.
 *
 * @returns Note text
 */
export function localProxyNote(): string {
  return '(loopback; likely a local proxy)';
}

/**
 * HAR log comment of a sanitized export.
 *
 * @returns Comment naming what was redacted and the flag that keeps it
 */
export function harSanitizedComment(): string {
  return 'Sanitized by bdg: values of auth, cookie, API key, token and session headers, cookies, credential query parameters in URLs, password/token/secret fields of JSON and form request and response bodies and WebSocket messages (also truncated JSON, JSON encoded in strings, socket.io, SockJS, server-sent events, NDJSON, and base64 bodies and binary messages that are UTF-8 text), and any JWT (also inside longer strings and form values) are [redacted] in place (by name, so some harmless values are too); everything else stays byte for byte. Not sanitized: other binary data, text that is not JSON or a form, and non-JSON syntax (single quotes, unquoted keys, JSONP, bare values with spaces); a body that could not be sanitized is [redacted] whole. Export with --include-sensitive to keep everything';
}

/**
 * Result of a HAR export to a file.
 */
export interface HarExportSummary {
  /** Absolute path written */
  file: string;
  /** Requests exported */
  entries: number;
  /** Whether --filter left requests out */
  filtered: boolean;
  /** Whether credentials were redacted */
  sanitized: boolean;
}

/**
 * Success message of `bdg network har`.
 *
 * @param result - Export result
 * @returns e.g. `✓ Exported 4 requests to /tmp/out.har` and a line on sanitization
 */
export function harExportedMessage(result: HarExportSummary): string {
  const filterNote = result.filtered ? ' (filtered)' : '';
  const note = result.sanitized
    ? 'Credentials sanitized (auth/cookie/API key/token headers, cookies, URL tokens, password and token fields of bodies and WebSocket messages are [redacted]); --include-sensitive keeps them'
    : '⚠ Includes credentials (--include-sensitive): share this file with care';
  return `✓ Exported ${result.entries} requests${filterNote} to ${result.file}\n  ${note}`;
}

/**
 * Footer of `network list` when `--page current` (or a preset's default)
 * left out requests of earlier pages that matched the filters.
 *
 * @param count - Requests hidden
 * @returns e.g. `3 requests from earlier pages hidden (--page all)`
 */
export function earlierPagesHiddenNote(count: number): string {
  return `${pluralize(count, 'request')} from earlier pages hidden (--page all)`;
}

/**
 * Why `details network --body` has nothing to print: the body was skipped or evicted.
 *
 * @param reason - Why it was not captured
 * @returns e.g. `not captured: evicted: total body budget (…)`
 */
export function responseBodyNotCapturedReason(reason: string): string {
  return `not captured: ${reason}`;
}

/**
 * Why `details network --body` has nothing to print: a WebSocket.
 *
 * @returns Reason text
 */
export function webSocketHasNoBodyReason(): string {
  return 'a WebSocket has messages, not a body (bdg details network <id> lists them)';
}

/**
 * Why `details network --body` has nothing to print: the response is still loading.
 *
 * @returns Reason text
 */
export function bodyStillLoadingReason(): string {
  return 'the request is still loading';
}

/**
 * Why `details network --body` has nothing to print: a HEAD request or a
 * 204, 205 or 304 response, which have no body.
 *
 * @returns Reason text
 */
export function noBodyInResponseReason(): string {
  return 'the response has no body';
}

/**
 * Hint (stderr) after `details network --body --body-max` printed part of the body.
 *
 * @param shown - Characters printed
 * @param total - Characters of the whole body
 * @returns e.g. `body cut at 100 of 150000 characters (--body-max 0 for all)`
 */
export function bodyCutHint(shown: number, total: number): string {
  return `body cut at ${shown} of ${total} characters (--body-max 0 for all)`;
}

/**
 * Why `details network --body` has nothing to print: the request finished without one.
 *
 * @returns Reason text
 */
export function noResponseBodyReason(): string {
  return 'no response body was captured (redirects, failed requests and some responses have none, and bodies are fetched just after a request finishes)';
}

/**
 * Note after a response body `details network` cut at its cap.
 *
 * @param remaining - Characters left out
 * @param requestId - Request id
 * @returns e.g. `… 594000 more characters (full body: bdg details network 123.4 --body)`
 */
export function bodyCutNote(remaining: number, requestId: string): string {
  return `… ${remaining} more characters (full body: ${sessionCommand(`bdg details network ${requestId} --body`)})`;
}

/**
 * Hint (stderr) after `details network --body` printed a binary body.
 *
 * @returns Hint text
 */
export function base64BodyHint(): string {
  return 'The body is binary, printed base64-encoded: pipe it through base64 -d';
}
