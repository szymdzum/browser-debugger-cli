/**
 * Page navigation for `bdg page navigate|reload|back|forward`.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import { UNREACHABLE_ERRORS } from '@/daemon/session/cdpSetup.js';
import { CommandError } from '@/errors/index.js';
import { navigationFailedError, noHistoryEntryError } from '@/errors/messages.js';
import type { PageAction, PageNavigationResult } from '@/ipc/protocol/commands.js';
import { delay } from '@/utils/async.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { normalizeUrl } from '@/utils/url.js';

/** How long to wait in all for the page to load and settle after navigating */
const PAGE_READY_TIMEOUT_MS = 15_000;

/**
 * Navigate the session's page and wait until it has loaded.
 *
 * @param cdp - CDP connection
 * @param action - Navigate to a URL, reload, or go back/forward in history
 * @param options - `url` for navigate, `wait: false` to return without waiting
 * @returns Where the page is now
 * @throws CommandError (80) for an unreachable URL, (81) without a history entry
 */
export async function navigatePage(
  cdp: CDPConnection,
  action: PageAction,
  options: { url?: string; wait?: boolean } = {}
): Promise<PageNavigationResult> {
  const tree = (await cdp.send('Page.getFrameTree', {})) as {
    frameTree: { frame: { id: string } };
  };
  const navigated = nextNavigation(cdp, tree.frameTree.frame.id);
  try {
    if (action === 'navigate') await navigateTo(cdp, normalizeUrl(options.url ?? ''));
    else if (action === 'reload') await cdp.send('Page.reload', {});
    else await goThroughHistory(cdp, action === 'back' ? -1 : 1);
    if (options.wait !== false) {
      const deadline = Date.now() + PAGE_READY_TIMEOUT_MS;
      const how = await Promise.race([navigated.done, delay(PAGE_READY_TIMEOUT_MS)]);
      if (how === 'loaded') {
        await waitForPageReady(cdp, { maxWaitMs: Math.max(0, deadline - Date.now()) });
      }
    }
  } finally {
    navigated.stop();
  }
  const location = (await cdp.send('Runtime.evaluate', {
    expression: '({ url: location.href, title: document.title })',
    returnByValue: true,
  })) as { result?: { value?: { url: string; title: string } } };
  return {
    action,
    url: location.result?.value?.url ?? '',
    title: location.result?.value?.title ?? '',
  };
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
 * @throws CommandError (80) when the URL cannot be reached
 */
async function navigateTo(cdp: CDPConnection, url: string): Promise<void> {
  const navigation = (await cdp.send('Page.navigate', { url })) as { errorText?: string };
  if (!navigation.errorText || !UNREACHABLE_ERRORS.test(navigation.errorText)) return;
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
    entries: Array<{ id: number }>;
  };
  const entry = history.entries[history.currentIndex + step];
  if (!entry) {
    const err = noHistoryEntryError(step < 0 ? 'back' : 'forward');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
}
