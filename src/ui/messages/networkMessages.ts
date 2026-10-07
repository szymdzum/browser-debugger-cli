/**
 * Network command messages (bdg network list)
 *
 * User-facing messages for the network list command output and formatting.
 */

import { MAX_NETWORK_REQUESTS, MAX_TOTAL_BODY_BYTES } from '@/constants.js';
import { pluralize } from '@/ui/formatting.js';

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
 * Why a stored response body was replaced by a placeholder (shown by
 * `bdg details network <id>` as `bodyNotCaptured`).
 *
 * @param budgetBytes - Total body budget of the session
 * @returns e.g. `evicted: total body budget (bdg keeps the newest 100 MB of response bodies)`
 */
export function bodyEvictedReason(budgetBytes: number): string {
  return `evicted: total body budget (bdg keeps the newest ${megabytes(budgetBytes)} of response bodies)`;
}

/** What a session's network capture let go at its limits */
export interface NetworkEvictionCounts {
  /** Oldest finished requests dropped at the request cap */
  requestsDropped: number;
  /** Oldest response bodies evicted at the body budget */
  bodiesEvicted: number;
}

/**
 * Note that the session dropped its oldest requests or evicted its oldest
 * response bodies at its limits.
 *
 * @param counts - Requests dropped and bodies evicted
 * @returns e.g. `⚠ 2000 older network requests were dropped: bdg keeps the newest 10000`;
 *   undefined when nothing was let go
 */
export function networkEvictedNote(counts: NetworkEvictionCounts): string | undefined {
  const { requestsDropped, bodiesEvicted } = counts;
  const requests = pluralize(requestsDropped, 'older network request');
  const bodies = pluralize(bodiesEvicted, 'older response body', 'older response bodies');
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

/**
 * Note after a loopback remote address of a request to another host and
 * port: Chrome probably connected to a proxy on this machine, not the server.
 *
 * @returns Note text
 */
export function localProxyNote(): string {
  return '(loopback; likely a local proxy)';
}
