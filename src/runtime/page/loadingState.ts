/**
 * Whether the page finished loading, and what it is still waiting for.
 *
 * Start and `bdg page` wait a limited time for the page; a document still
 * `loading` after that (a script whose server never answers) makes every
 * later command misleading, so they report it with the requests still
 * running.
 */

import { sendTyped } from '@/connection/typed-cdp.js';
import type { PendingRequestInfo, PageLoadingState } from '@/ipc/protocol/commands.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import { raceTimeout } from '@/utils/async.js';
import { displayUrl } from '@/utils/displayUrl.js';
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
      url: displayUrl(request.url),
      ...(request.resourceType && { resourceType: request.resourceType }),
      pendingMs: Math.max(0, now - request.timestamp),
    }));
}

/** What the page says about its document */
interface DocumentState {
  readyState: string;
  /** When the document started (`performance.timeOrigin`, ms since the epoch) */
  startedAt?: number;
}

/**
 * The page's `document.readyState` and when the document started.
 *
 * @param cdp - CDP connection
 * @returns The state, or undefined when the page did not answer in time
 */
async function readDocumentState(cdp: CDPSender): Promise<DocumentState | undefined> {
  try {
    const evaluated = sendTyped(cdp, 'Runtime.evaluate', {
      expression: '({ readyState: document.readyState, startedAt: performance.timeOrigin })',
      returnByValue: true,
    });
    evaluated.catch(() => undefined);
    const value = (await raceTimeout(evaluated, READY_STATE_TIMEOUT_MS))?.result?.value as
      { readyState?: unknown; startedAt?: unknown } | undefined;
    if (typeof value?.readyState !== 'string') return undefined;
    return {
      readyState: value.readyState,
      ...(typeof value.startedAt === 'number' && { startedAt: value.startedAt }),
    };
  } catch (error) {
    log.debug(`Could not read document.readyState: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * The page's `document.readyState`.
 *
 * @param cdp - CDP connection
 * @returns The state, or undefined when the page did not answer in time
 */
export async function readDocumentReadyState(cdp: CDPSender): Promise<string | undefined> {
  return (await readDocumentState(cdp))?.readyState;
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
  const document = await readDocumentState(cdp);
  if (document === undefined || document.readyState === 'complete') return undefined;
  return loadingStateOf(document.readyState, pending, document.startedAt);
}

/**
 * The loading state for a readyState that is not `complete`.
 *
 * @param readyState - `document.readyState`
 * @param pending - Requests still running (from the session's network telemetry)
 * @param documentStartedAt - When the current document started (ms); requests sent before
 *   belong to a page navigated away from and are left out
 * @returns The state with the requests to name and how many are running
 */
export function loadingStateOf(
  readyState: string,
  pending: Iterable<PendingRequest>,
  documentStartedAt?: number
): PageLoadingState {
  const requests = [...pending].filter(
    ({ request }) => documentStartedAt === undefined || request.timestamp >= documentStartedAt
  );
  return {
    readyState,
    pending: summarizePendingRequests(requests, Date.now()),
    pendingCount: requests.length,
  };
}
