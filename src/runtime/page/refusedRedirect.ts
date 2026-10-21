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
import type { Protocol } from '@/connection/typed-cdp.js';
import { watchMainDocuments, type MainDocument } from '@/runtime/page/failedLoad.js';
import type { FailedLoad } from '@/types.js';

/** How long an aborted request without a response waits for its redirect's headers */
const REDIRECT_HEADERS_GRACE_MS = 500;

/** A URL's scheme, when it has one (a relative `Location` has none) */
const SCHEME = /^([a-z][a-z\d+.-]*):/i;

/** Schemes Chrome follows a redirect to as a page load */
const LOADABLE_SCHEMES = new Set(['http', 'https']);

/** The redirects Chrome refused during a navigation or an action */
export interface RefusedRedirectWatch {
  /**
   * The refused redirect of a main document request, once the verdict is in.
   * `awaitOpen`: requests not answered yet are waited on too, up to the grace
   * (after a `Page.navigate` that Chrome answered before the request failed).
   */
  refused: (options?: { awaitOpen?: boolean }) => Promise<FailedLoad | undefined>;
  /** Stops following */
  stop: () => void;
}

/**
 * Whether a redirect target is a URL Chrome refuses to load as a page.
 *
 * @param url - Next hop's URL or a `Location` header
 * @returns True for an absolute URL outside http(s)
 */
function isRefusedTarget(url: string | undefined): url is string {
  const scheme = url === undefined ? undefined : SCHEME.exec(url)?.[1];
  return scheme !== undefined && !LOADABLE_SCHEMES.has(scheme.toLowerCase());
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
 * Wait until no deadline is pending: re-checked on each change and when the
 * latest deadline passes.
 *
 * @param latestDeadline - The latest pending deadline (epoch ms), or undefined when nothing waits
 * @param waiters - Called on each change
 */
function waitForDeadlines(
  latestDeadline: () => number | undefined,
  waiters: Set<() => void>
): Promise<void> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const check = (): void => {
      clearTimeout(timer);
      const deadline = latestDeadline();
      if (deadline === undefined) {
        waiters.delete(check);
        resolve();
        return;
      }
      timer = setTimeout(check, deadline - Date.now());
    };
    waiters.add(check);
    check();
  });
}

/**
 * Follow the main frame's document requests and tell which ones ended on a
 * redirect Chrome refused. Nothing waits unless a request was aborted
 * without a response: then up to the grace for its redirect's headers.
 *
 * @param cdp - CDP connection
 * @param mainFrameId - Main frame id
 * @param graceMs - How long an aborted request waits for its redirect's headers
 * @returns The watch
 */
export function watchRefusedRedirects(
  cdp: Pick<CDPConnection, 'on'>,
  mainFrameId: string,
  graceMs = REDIRECT_HEADERS_GRACE_MS
): RefusedRedirectWatch {
  const aborted = new Map<string, MainDocument & { abortedAt: number }>();
  const responded = new Set<string>();
  const locations = new Map<string, string>();
  const waiters = new Set<() => void>();
  const changed = (): void => waiters.forEach((waiter) => waiter());
  const documents = watchMainDocuments(
    cdp,
    mainFrameId,
    () => undefined,
    (requestId, document) => {
      aborted.set(requestId, { ...document, abortedAt: Date.now() });
      changed();
    }
  );
  const stops = [
    cdp.on<Protocol.Network.ResponseReceivedEvent>('Network.responseReceived', (params) => {
      if (documents.isDocument(params.requestId)) responded.add(params.requestId);
    }),
    cdp.on<Protocol.Network.ResponseReceivedExtraInfoEvent>(
      'Network.responseReceivedExtraInfo',
      (params) => {
        const { requestId } = params;
        const location = redirectLocation(params);
        if (location === undefined) return;
        if (!documents.isDocument(requestId) && !aborted.has(requestId)) return;
        locations.set(requestId, location);
        changed();
      }
    ),
  ];
  const verdict = (requestId: string): FailedLoad | undefined => {
    const request = aborted.get(requestId);
    if (!request || responded.has(requestId)) return undefined;
    const hop = request.last !== request.url ? request.last : undefined;
    const redirectedTo = [hop, locations.get(requestId)].find(isRefusedTarget);
    return redirectedTo === undefined
      ? undefined
      : { url: request.url, errorText: ABORTED_ERROR, redirectedTo };
  };
  const deadline = (requestId: string, openUntil: number): number | undefined => {
    if (responded.has(requestId) || verdict(requestId)) return undefined;
    const abortedAt = aborted.get(requestId)?.abortedAt;
    const until = abortedAt === undefined ? openUntil : abortedAt + graceMs;
    return until > Date.now() ? until : undefined;
  };
  const refused = async (
    options: { awaitOpen?: boolean } = {}
  ): Promise<FailedLoad | undefined> => {
    const openUntil = options.awaitOpen === true ? Date.now() + graceMs : 0;
    await waitForDeadlines(() => {
      const ids = [...aborted.keys(), ...(openUntil > 0 ? documents.requestIds() : [])];
      const deadlines = ids.flatMap((id) => deadline(id, openUntil) ?? []);
      return deadlines.length > 0 ? Math.max(...deadlines) : undefined;
    }, waiters);
    return [...aborted.keys()].map(verdict).find((found) => found !== undefined);
  };
  return {
    refused,
    stop: () => {
      documents.stop();
      stops.forEach((stop) => stop());
    },
  };
}

/**
 * The refused redirect of a navigation Chrome answered with `net::ERR_ABORTED`.
 *
 * @param watch - Watch started before the navigation
 * @param navigation - Chrome's answer to `Page.navigate`
 * @returns The refused redirect, or undefined (also for any other answer)
 */
export async function refusedAfterAbort(
  watch: RefusedRedirectWatch,
  navigation: { errorText?: string }
): Promise<FailedLoad | undefined> {
  return navigation.errorText === ABORTED_ERROR ? watch.refused({ awaitOpen: true }) : undefined;
}
