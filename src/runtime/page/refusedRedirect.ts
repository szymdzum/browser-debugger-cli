/**
 * Redirects Chrome refuses to follow (#890): a main document whose server
 * redirects to a scheme Chrome does not load as a page (`myapp://callback`,
 * `javascript:`, `view-source:`). Chrome aborts the request
 * (`net::ERR_ABORTED`, as for a 204 or a download) and keeps the page it was
 * on, so neither `Page.navigate`'s answer nor the main frame tells it apart.
 * The request does: a 204 or a download got a response, a refused redirect
 * did not, and its redirect (the next hop's request, or the `Location` of
 * the raw headers, which may come just after the failure) leads outside
 * http(s).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { ABORTED_ERROR } from '@/connection/navigationOutcome.js';
import { sendTyped, type Protocol } from '@/connection/typed-cdp.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import type { FailedLoad } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/** How long an aborted request without a response waits for its redirect's headers */
const REDIRECT_HEADERS_GRACE_MS = 500;

/** Schemes Chrome follows a redirect to as a page load */
const LOADABLE_SCHEME = /^https?:/i;

/** A followed document request */
interface Followed {
  frameId: string;
  /** URL first requested */
  url: string;
  /** URL of the latest hop */
  last: string;
  /** Where a redirect leads outside http(s) */
  refusedTo?: string;
  responded: boolean;
  /** Chrome's error, once the request was aborted */
  aborted?: string;
  /** Set once the grace for the redirect's headers has passed */
  settled: boolean;
  /** The request finished or failed */
  done: boolean;
}

/** The fields of `Network.requestWillBeSent` read here */
interface DocumentRequest {
  requestId: string;
  type?: string;
  frameId?: string;
  request?: { url: string };
  redirectResponse?: unknown;
}

/**
 * Where a `Location` header leads, resolved against the request it answers.
 *
 * @param location - Header value
 * @param base - URL of the request
 * @returns Absolute URL, or the header as sent when it does not parse
 */
function resolveLocation(location: string, base: string): string {
  try {
    return new URL(location, base).href;
  } catch (error) {
    log.debug(`Location not resolved: ${getErrorMessage(error)}`);
    return location;
  }
}

/**
 * The `Location` header of a redirect's raw headers.
 *
 * @param event - `Network.responseReceivedExtraInfo`
 * @returns The header, for a 3xx status
 */
function redirectLocation(
  event: Protocol.Network.ResponseReceivedExtraInfoEvent
): string | undefined {
  if (event.statusCode < 300 || event.statusCode > 399) return undefined;
  const name = Object.keys(event.headers).find((key) => key.toLowerCase() === 'location');
  return name === undefined ? undefined : event.headers[name];
}

/**
 * The refused redirect of a request, once Chrome aborted it without a response.
 *
 * @param doc - Followed request
 * @returns The failed load, its URL as first requested
 */
function verdictOf(doc: Followed): FailedLoad | undefined {
  if (!doc.aborted || doc.responded || !doc.refusedTo) return undefined;
  return { url: doc.url, errorText: doc.aborted, redirectedTo: doc.refusedTo };
}

/**
 * Whether a request's verdict may still change: aborted without a response
 * and its redirect not known yet, within the grace; or, when open requests
 * count, not answered yet.
 *
 * @param doc - Followed request
 * @param open - Whether a request not answered yet counts, until its wait expired
 * @returns Whether to wait for it
 */
function pending(doc: Followed, open: boolean): boolean {
  if (doc.responded || doc.refusedTo) return false;
  return doc.aborted === undefined ? open && !doc.done : !doc.settled;
}

/**
 * Follow the main frame's document requests and tell which ones ended on a
 * redirect Chrome refused. Nothing waits unless a request was aborted
 * without a response: then up to {@link REDIRECT_HEADERS_GRACE_MS} for its
 * redirect's headers.
 *
 * @param cdp - CDP connection
 * @param mainFrameId - Main frame id, or a function that reads it when a verdict is asked
 * @param graceMs - How long an aborted request waits for its redirect's headers
 * @returns `refused`: the refused redirect of a request (or of any request
 *   followed, without an id), once its verdict is in (`awaitOpen`: requests
 *   not answered yet are waited on too, up to the grace, as after a
 *   `Page.navigate` that Chrome answered before the request failed);
 *   `stop`: stops following
 */
export function watchRefusedRedirects(
  cdp: Pick<CDPConnection, 'on'>,
  mainFrameId: string | (() => Promise<string>),
  graceMs = REDIRECT_HEADERS_GRACE_MS
): {
  refused: (
    requestId?: string,
    options?: { awaitOpen?: boolean }
  ) => Promise<FailedLoad | undefined>;
  stop: () => void;
} {
  const followed = new Map<string, Followed>();
  const waiters = new Set<() => void>();
  const changed = (): void => waiters.forEach((waiter) => waiter());
  const markRefused = (doc: Followed, target: string): void => {
    if (!LOADABLE_SCHEME.test(target)) doc.refusedTo ??= target;
  };
  const stops = [
    cdp.on<DocumentRequest>('Network.requestWillBeSent', (params) => {
      if (params.type !== 'Document' || params.frameId === undefined) return;
      const url = params.request?.url ?? '';
      const doc = followed.get(params.requestId);
      if (!doc) {
        followed.set(params.requestId, {
          frameId: params.frameId,
          url,
          last: url,
          responded: false,
          settled: false,
          done: false,
        });
        return;
      }
      doc.last = url;
      if (params.redirectResponse) markRefused(doc, url);
      changed();
    }),
    cdp.on<Protocol.Network.ResponseReceivedExtraInfoEvent>(
      'Network.responseReceivedExtraInfo',
      (params) => {
        const doc = followed.get(params.requestId);
        const location = doc && redirectLocation(params);
        if (!doc || location === undefined) return;
        markRefused(doc, resolveLocation(location, doc.last));
        changed();
      }
    ),
    cdp.on<Protocol.Network.ResponseReceivedEvent>('Network.responseReceived', (params) => {
      const doc = followed.get(params.requestId);
      if (doc) doc.responded = true;
    }),
    cdp.on<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', (params) => {
      const doc = followed.get(params.requestId);
      if (!doc) return;
      doc.done = true;
      changed();
    }),
    cdp.on<Protocol.Network.LoadingFailedEvent>('Network.loadingFailed', (params) => {
      const doc = followed.get(params.requestId);
      if (!doc) return;
      doc.done = true;
      if (params.errorText !== ABORTED_ERROR) return changed();
      doc.aborted = params.errorText;
      setTimeout(() => {
        doc.settled = true;
        changed();
      }, graceMs);
      changed();
    }),
  ];
  const refused = async (
    requestId?: string,
    options: { awaitOpen?: boolean } = {}
  ): Promise<FailedLoad | undefined> => {
    const open = options.awaitOpen === true;
    const candidates = [...followed.entries()]
      .filter(
        ([id, doc]) =>
          (requestId === undefined || id === requestId) &&
          (doc.aborted !== undefined || (open && !doc.done))
      )
      .map(([, doc]) => doc);
    if (candidates.length === 0) return undefined;
    const frameId = typeof mainFrameId === 'string' ? mainFrameId : await mainFrameId();
    const own = candidates.filter((doc) => doc.frameId === frameId);
    let waitOpen = open;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waitOpen = false;
        check();
      }, graceMs);
      const check = (): void => {
        if (own.some((doc) => pending(doc, waitOpen))) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });
    return own.map(verdictOf).find((verdict) => verdict !== undefined);
  };
  return { refused, stop: () => stops.forEach((stop) => stop()) };
}

/**
 * The page's main frame id (a page target's id is its main frame's). Answers
 * while a navigation waits for the server.
 *
 * @param cdp - CDP connection
 * @returns Main frame id
 */
export async function readMainFrameId(cdp: CDPSender): Promise<string> {
  return (await sendTyped(cdp, 'Target.getTargetInfo', {})).targetInfo.targetId;
}
