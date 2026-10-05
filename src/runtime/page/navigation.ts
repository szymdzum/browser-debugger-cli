/**
 * Page navigation for `bdg page navigate|reload|back|forward`.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import { UNREACHABLE_ERRORS } from '@/daemon/session/cdpSetup.js';
import { CommandError } from '@/errors/index.js';
import { navigationFailedError, noHistoryEntryError } from '@/errors/messages.js';
import type { PageAction, PageNavigationResult } from '@/ipc/protocol/commands.js';
import { readPageLoadingState } from '@/runtime/page/loadingState.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type { CDPSender } from '@/telemetry/objectExpander.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  documentStatusWarning,
  notAPageWarning,
  stillLoadingWarning,
} from '@/ui/messages/commands.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { normalizeUrl } from '@/utils/url.js';

const log = createLogger('session');

/** How long to wait in all for the page to load and settle after navigating */
const PAGE_READY_TIMEOUT_MS = 15_000;

/**
 * Navigate the session's page and wait until it has loaded.
 *
 * With `wait: false` the command is sent and the call returns at once (the
 * navigation may still be waiting for the server). Otherwise the server gets
 * {@link PAGE_READY_TIMEOUT_MS} to answer, then the new document is waited on
 * to settle; its HTTP status is reported, with a warning for 4xx/5xx, for a
 * URL that is a download, or a server that has not answered. A document
 * that has not finished loading by then is reported as `loading`, with the
 * requests it waits on.
 *
 * @param cdp - CDP connection
 * @param action - Navigate to a URL, reload, or go back/forward in history
 * @param options - `url` for navigate, `wait: false` to return without waiting,
 *   `pendingRequests`: the session's requests still running
 * @returns Where the page is now
 * @throws CommandError (80) for an unreachable URL, (81) without a history entry
 */
export async function navigatePage(
  cdp: CDPConnection,
  action: PageAction,
  options: { url?: string; wait?: boolean; pendingRequests?: () => Iterable<PendingRequest> } = {}
): Promise<PageNavigationResult> {
  const url = action === 'navigate' ? normalizeUrl(options.url ?? '') : undefined;
  if (options.wait === false) return startWithoutWaiting(cdp, action, url);
  const mainFrameId = (await pageTarget(cdp)).targetId;
  const navigated = nextNavigation(cdp, mainFrameId);
  const document = documentResponse(cdp, mainFrameId);
  const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
  try {
    const sent = startAction(cdp, action, url);
    sent.catch(() => undefined);
    const started = await Promise.race([sent, delay(PAGE_READY_TIMEOUT_MS)]);
    if (started === undefined) return await stillLoading(cdp, action);
    if (started === 'not-a-page') {
      return { action, ...(await currentLocation(cdp)), warning: notAPageWarning() };
    }
    const how = await Promise.race([navigated.done, delay(Math.max(0, deadline - Date.now()))]);
    if (how === 'loaded') {
      await waitForPageReady(cdp, { maxWaitMs: Math.max(0, deadline - Date.now()) });
    }
  } finally {
    navigated.stop();
    document.stop();
  }
  const result = withStatus({ action, ...(await currentLocation(cdp)) }, document.response());
  const loading = await readPageLoadingState(cdp, options.pendingRequests?.() ?? []);
  return loading ? { ...result, loading } : result;
}

/** How long `--no-wait` waits for an action to be refused (no history entry, unreachable URL) */
const NO_WAIT_GRACE_MS = 1_000;

/**
 * Start an action without waiting for the page: errors that come at once
 * are still reported, a server that has not answered is not waited for.
 *
 * @param cdp - CDP connection
 * @param action - What to do
 * @param url - Normalized URL for navigate
 * @returns The URL being loaded
 * @throws CommandError (80) for an unreachable URL, (81) without a history entry
 */
async function startWithoutWaiting(
  cdp: CDPConnection,
  action: PageAction,
  url: string | undefined
): Promise<PageNavigationResult> {
  const sent = startAction(cdp, action, url);
  sent.catch((error: unknown) => log.debug(`Navigation not started: ${getErrorMessage(error)}`));
  const started = await Promise.race([sent, delay(NO_WAIT_GRACE_MS)]);
  const result = { action, url: url ?? (await pageTarget(cdp)).url, title: '' };
  return started === 'not-a-page' ? { ...result, warning: notAPageWarning() } : result;
}

/**
 * Send the command of an action.
 *
 * @param cdp - CDP connection
 * @param action - What to do
 * @param url - Normalized URL for navigate
 * @returns 'not-a-page' when the URL loaded no document (a download), else 'started'
 * @throws CommandError (80) when the URL cannot be reached, (81) without a history entry
 */
async function startAction(
  cdp: CDPConnection,
  action: PageAction,
  url: string | undefined
): Promise<'started' | 'not-a-page'> {
  if (action === 'navigate') return navigateTo(cdp, url ?? '');
  if (action === 'reload') await cdp.send('Page.reload', {});
  else await goThroughHistory(cdp, action === 'back' ? -1 : 1);
  return 'started';
}

/**
 * The page target as the browser sees it. Unlike the page's own state, this
 * answers while a navigation waits for the server (Chrome holds commands for
 * the page until the new document commits). A page target's id is its main
 * frame's id; its URL is the one being navigated to.
 *
 * @param cdp - CDP connection
 * @returns Target id and URL
 */
async function pageTarget(cdp: CDPSender): Promise<{ targetId: string; url: string }> {
  const { targetInfo } = (await cdp.send('Target.getTargetInfo', {})) as {
    targetInfo: { targetId: string; url: string };
  };
  return targetInfo;
}

/**
 * The URL of a navigation still waiting for the server, if any: the page
 * target already shows it while the history's current entry does not.
 *
 * @param cdp - CDP connection
 * @returns The pending URL, or undefined when the page is not navigating
 */
export async function pendingNavigationUrl(cdp: CDPSender): Promise<string | undefined> {
  const [target, history] = await Promise.all([
    pageTarget(cdp),
    cdp.send('Page.getNavigationHistory', {}) as Promise<{
      currentIndex: number;
      entries: Array<{ url: string }>;
    }>,
  ]);
  const committedUrl = history.entries[history.currentIndex]?.url;
  return target.url !== committedUrl ? target.url : undefined;
}

/**
 * The page's URL and title.
 *
 * @param cdp - CDP connection
 * @returns URL and title
 */
async function currentLocation(cdp: CDPConnection): Promise<{ url: string; title: string }> {
  const location = (await cdp.send('Runtime.evaluate', {
    expression: '({ url: location.href, title: document.title })',
    returnByValue: true,
  })) as { result?: { value?: { url: string; title: string } } };
  return { url: location.result?.value?.url ?? '', title: location.result?.value?.title ?? '' };
}

/**
 * Result for a server that has not answered within the time limit.
 *
 * @param cdp - CDP connection
 * @param action - What was done
 * @returns The URL being loaded, with a warning
 */
async function stillLoading(cdp: CDPConnection, action: PageAction): Promise<PageNavigationResult> {
  return {
    action,
    url: (await pageTarget(cdp)).url,
    title: '',
    warning: stillLoadingWarning(PAGE_READY_TIMEOUT_MS),
  };
}

/** HTTP response of a document loaded in the main frame */
interface DocumentResponse {
  status: number;
  url: string;
}

/** Documents the main frame loaded during a navigation */
interface DocumentResponses {
  /** The navigation's own document (after HTTP redirects) */
  first: DocumentResponse;
  /** The last document loaded after it (a script or meta refresh moved on), if any */
  later?: DocumentResponse;
}

/**
 * Add the HTTP status of the navigation's own document, with a warning for an
 * error status or for a later document that answered differently (a 404 page
 * whose script loads the app, as single-page apps on static hosts do).
 *
 * @param result - Navigation result
 * @param documents - The main frame's document responses, if one arrived
 * @returns Result with status
 */
function withStatus(
  result: PageNavigationResult,
  documents: DocumentResponses | undefined
): PageNavigationResult {
  if (!documents) return result;
  const { first, later } = documents;
  const url = result.url.startsWith('chrome-error://') ? first.url : result.url;
  const warning = documentStatusWarning(first.status, later);
  return { ...result, url, status: first.status, ...(warning && { warning }) };
}

/**
 * Watch for the responses of the main frame's documents. The first one is
 * the navigation's own; later ones were loaded by the page itself.
 *
 * @param cdp - CDP connection
 * @param mainFrameId - Main frame id
 * @returns The responses seen so far, and a function to stop listening
 */
function documentResponse(
  cdp: CDPConnection,
  mainFrameId: string
): { response: () => DocumentResponses | undefined; stop: () => void } {
  let seen: DocumentResponses | undefined;
  const stop = cdp.on<{
    type?: string;
    frameId?: string;
    response: DocumentResponse;
  }>('Network.responseReceived', (params) => {
    if (params.type !== 'Document' || params.frameId !== mainFrameId) return;
    const response = { status: params.response.status, url: params.response.url };
    if (seen) seen.later = response;
    else seen = { first: response };
  });
  return { response: () => seen, stop };
}

/**
 * Resolve once the page has loaded a new document, moved within its
 * document (hash or history changes), or was restored from the back/forward
 * cache (those fire no load event). Only a newly loaded document is then
 * waited on to settle: a restored or same-document page already is. Without this, the
 * readiness check would see the old page, still complete, and return at once.
 *
 * @param cdp - CDP connection
 * @param mainFrameId - The page's main frame (iframes moving within their document don't count)
 * @returns The wait, and a function to stop listening
 */
function nextNavigation(
  cdp: CDPConnection,
  mainFrameId: string
): {
  done: Promise<'loaded' | 'restored' | 'same-document'>;
  stop: () => void;
} {
  const unsubscribes: Array<() => void> = [];
  const done = new Promise<'loaded' | 'restored' | 'same-document'>((resolve) => {
    unsubscribes.push(cdp.on('Page.loadEventFired', () => resolve('loaded')));
    unsubscribes.push(
      cdp.on<{ frameId: string }>('Page.navigatedWithinDocument', (params) => {
        if (params.frameId === mainFrameId) resolve('same-document');
      })
    );
    unsubscribes.push(
      cdp.on<{ frame: { parentId?: string }; type?: string }>('Page.frameNavigated', (params) => {
        if (!params.frame.parentId && params.type === 'BackForwardCacheRestore') {
          resolve('restored');
        }
      })
    );
  });
  return { done, stop: () => unsubscribes.forEach((unsubscribe) => unsubscribe()) };
}

/**
 * Load a URL in the page.
 *
 * @param cdp - CDP connection
 * @param url - Normalized URL
 * @returns 'not-a-page' when no document was loaded (a download), else 'started'
 * @throws CommandError (80) when the URL cannot be reached
 */
async function navigateTo(cdp: CDPConnection, url: string): Promise<'started' | 'not-a-page'> {
  const navigation = (await cdp.send('Page.navigate', { url })) as {
    errorText?: string;
    loaderId?: string;
  };
  if (navigation.errorText === 'net::ERR_ABORTED' && !navigation.loaderId) return 'not-a-page';
  if (!navigation.errorText || !UNREACHABLE_ERRORS.test(navigation.errorText)) return 'started';
  const err = navigationFailedError(url, navigation.errorText);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_URL);
}

/**
 * Go back or forward one entry in the page's history.
 *
 * @param cdp - CDP connection
 * @param step - -1 for back, 1 for forward
 * @throws CommandError (81) when there is no such entry
 */
async function goThroughHistory(cdp: CDPConnection, step: -1 | 1): Promise<void> {
  const history = (await cdp.send('Page.getNavigationHistory', {})) as {
    currentIndex: number;
    entries: Array<{ id: number; url: string }>;
  };
  const index = history.currentIndex + step;
  const entry = history.entries[index];
  const blankStart = index === 0 && entry?.url === 'about:blank';
  if (!entry || blankStart) {
    const err = noHistoryEntryError(step < 0 ? 'back' : 'forward');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
}
