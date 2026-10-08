/**
 * Scrolling an element into view for a page screenshot (`--scroll`), and
 * waiting for the page to settle afterwards (lazy loading, mutations).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { noNodesFoundError } from '@/errors/messages.js';
import { DEEP_QUERY_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { evaluateValue, type ScrollPosition } from '@/runtime/page/captureEmulation.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

const POST_SCROLL_NETWORK_IDLE_MS = 150;
const POST_SCROLL_DOM_STABLE_MS = 200;
const POST_SCROLL_MAX_WAIT_MS = 2000;
const STABILITY_CHECK_INTERVAL_MS = 50;

/** Page-side: start recording resource loads and DOM mutations */
const WATCH_STABILITY_JS = `(() => {
  window.__bdg_scrollStability = {
    lastNetworkActivity: Date.now(),
    lastDomMutation: Date.now(),
    activeRequests: 0
  };
  const state = window.__bdg_scrollStability;
  if (window.PerformanceObserver) {
    const perfObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'resource') state.lastNetworkActivity = Date.now();
      }
    });
    try {
      perfObserver.observe({ entryTypes: ['resource'] });
      state.perfObserver = perfObserver;
    } catch (e) {}
  }
  const mutationObserver = new MutationObserver(() => {
    state.lastDomMutation = Date.now();
  });
  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });
  state.mutationObserver = mutationObserver;
})()`;

/** Page-side: milliseconds since the last resource load and DOM mutation */
const STABILITY_JS = `(() => {
  const state = window.__bdg_scrollStability;
  if (!state) return { networkIdle: 999, domIdle: 999 };
  return {
    networkIdle: Date.now() - state.lastNetworkActivity,
    domIdle: Date.now() - state.lastDomMutation
  };
})()`;

/** Page-side: stop recording */
const UNWATCH_STABILITY_JS = `(() => {
  const state = window.__bdg_scrollStability;
  if (state) {
    state.perfObserver?.disconnect();
    state.mutationObserver?.disconnect();
    delete window.__bdg_scrollStability;
  }
})()`;

/**
 * Wait for the page to settle after a programmatic scroll (lazy-load idle +
 * DOM mutation idle). Uses shorter thresholds than full page load.
 *
 * @param cdp - Session connection
 */
async function waitForPostScrollStability(cdp: CDPConnection): Promise<void> {
  const deadline = Date.now() + POST_SCROLL_MAX_WAIT_MS;
  await evaluateValue(cdp, WATCH_STABILITY_JS);
  try {
    while (Date.now() < deadline) {
      const value = (await evaluateValue(cdp, STABILITY_JS)) as
        { networkIdle?: number; domIdle?: number } | undefined;
      const networkIdle = value?.networkIdle ?? 0;
      const domIdle = value?.domIdle ?? 0;
      if (networkIdle >= POST_SCROLL_NETWORK_IDLE_MS && domIdle >= POST_SCROLL_DOM_STABLE_MS) {
        log.debug(`Post-scroll stable: network ${networkIdle}ms, DOM ${domIdle}ms`);
        return;
      }
      await delay(STABILITY_CHECK_INTERVAL_MS);
    }
    log.debug('Post-scroll stability timeout, proceeding anyway');
  } finally {
    await evaluateValue(cdp, UNWATCH_STABILITY_JS);
  }
}

/**
 * Scroll an element into view (centered) and wait for the page to settle.
 *
 * @param cdp - Session connection
 * @param selector - The element
 * @returns Scroll position before, to put the page back afterwards
 * @throws CommandError (83) when nothing matches
 */
export async function scrollToElement(
  cdp: CDPConnection,
  selector: string
): Promise<ScrollPosition> {
  const value = (await evaluateValue(
    cdp,
    `(() => {
      const el = (${DEEP_QUERY_JS})(${selectorArgsJS(selector)})[0];
      if (!el) return { found: false };
      const originalX = window.scrollX;
      const originalY = window.scrollY;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      return { found: true, originalX, originalY };
    })()`
  )) as { found?: boolean; originalX?: number; originalY?: number } | undefined;
  if (!value?.found) {
    const err = noNodesFoundError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  await waitForPostScrollStability(cdp);
  return { x: value.originalX ?? 0, y: value.originalY ?? 0 };
}

/**
 * Scroll an element into view again (centered), e.g. after an override moved
 * the page.
 *
 * @param cdp - Session connection
 * @param selector - The element
 */
export async function scrollIntoViewAgain(cdp: CDPConnection, selector: string): Promise<void> {
  await evaluateValue(
    cdp,
    `(${DEEP_QUERY_JS})(${selectorArgsJS(selector)})[0]?.scrollIntoView({ block: 'center', behavior: 'instant' })`
  );
}
