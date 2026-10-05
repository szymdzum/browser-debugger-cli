/**
 * Whether the page finished loading, and what it is still waiting for.
 *
 * Start and `bdg page` wait a limited time for the page; a document still
 * `loading` after that (a script whose server never answers) makes every
 * later command misleading, so they report it with the requests still
 * running.
 */

import type { PendingRequestInfo, PageLoadingState } from '@/ipc/protocol/commands.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('readiness');

/** Pending requests named in the report */
const MAX_NAMED_PENDING_REQUESTS = 3;

/** How long the page gets to report its readyState (a busy page is not waited on) */
const READY_STATE_TIMEOUT_MS = 1000;

/** Request types that never hold up the load event, listed after the ones that do */
const NON_BLOCKING_TYPES = new Set([
  'XHR',
  'Fetch',
  'EventSource',
  'Ping',
  'Preflight',
  'Prefetch',
]);

/**
 * The requests to name: load-blocking ones (scripts, styles, images, frames)
 * first, the longest-running first within each group.
 *
 * @param pending - Requests still running
 * @param now - Current time (ms)
 * @returns Up to {@link MAX_NAMED_PENDING_REQUESTS} requests
 */
export function summarizePendingRequests(
  pending: Iterable<PendingRequest>,
  now: number
): PendingRequestInfo[] {
  const rank = (entry: PendingRequest): number =>
    NON_BLOCKING_TYPES.has(entry.request.resourceType ?? '') ? 1 : 0;
  return [...pending]
    .sort((a, b) => rank(a) - rank(b) || a.request.timestamp - b.request.timestamp)
    .slice(0, MAX_NAMED_PENDING_REQUESTS)
    .map(({ request }) => ({
      method: request.method,
      url: request.url,
      ...(request.resourceType && { resourceType: request.resourceType }),
      pendingMs: Math.max(0, now - request.timestamp),
    }));
}

/**
 * The page's `document.readyState`.
 *
 * @param cdp - CDP connection
 * @returns The state, or undefined when the page did not answer in time
 */
async function readDocumentReadyState(cdp: CDPSender): Promise<string | undefined> {
  try {
    const evaluated = cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    }) as Promise<{ result?: { value?: unknown } }>;
    evaluated.catch(() => undefined);
    const response = await Promise.race([evaluated, delay(READY_STATE_TIMEOUT_MS)]);
    const value = response?.result?.value;
    return typeof value === 'string' ? value : undefined;
  } catch (error) {
    log.debug(`Could not read document.readyState: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * What the page is still loading, if it has not finished.
 *
 * @param cdp - CDP connection
 * @param pending - Requests still running (from the session's network telemetry)
 * @returns The loading state, or undefined when the document is complete or did not answer
 */
export async function readPageLoadingState(
  cdp: CDPSender,
  pending: Iterable<PendingRequest>
): Promise<PageLoadingState | undefined> {
  const readyState = await readDocumentReadyState(cdp);
  if (readyState === undefined || readyState === 'complete') return undefined;
  const requests = [...pending];
  return {
    readyState,
    pending: summarizePendingRequests(requests, Date.now()),
    pendingCount: requests.length,
  };
}
