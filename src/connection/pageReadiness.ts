/**
 * Smart page readiness detection using fixed thresholds
 *
 * This module provides page load detection that works for most page types
 * without configuration. It uses a two-phase approach:
 * 1. Load event (baseline readiness)
 * 2. Network (200ms idle) and DOM (300ms without mutations) quiet at once
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { trackInFlightRequests } from '@/connection/inFlightRequests.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('readiness');

/** Network idle threshold in milliseconds - network is stable when no requests for this duration */
const NETWORK_IDLE_THRESHOLD_MS = 200;
/** DOM stable threshold in milliseconds - DOM is stable when no mutations for this duration */
const DOM_STABLE_THRESHOLD_MS = 300;
/** Interval for checking deadline expiration in milliseconds */
const DEADLINE_CHECK_INTERVAL_MS = 100;
/** Interval for checking network and DOM activity in milliseconds */
const QUIET_CHECK_INTERVAL_MS = 50;

/**
 * Options for page readiness detection
 */
export interface PageReadinessOptions {
  /**
   * Maximum wait time before proceeding anyway
   * Default: 5000ms (5 seconds)
   */
  maxWaitMs?: number;
}

/**
 * Wait for page to be ready using fixed thresholds
 *
 * Strategy (always applied):
 * 1. Wait for load event (baseline readiness)
 * 2. Wait for the network (200ms idle) and the DOM (300ms without
 *    mutations) to be quiet at the same time
 *
 * Uses fixed thresholds that work well for most pages.
 * No framework detection, no configuration needed.
 * Works for static HTML, SPAs, and everything in between.
 *
 * @param cdp - CDP connection
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * // Default: Wait up to 5s for full stability
 * await waitForPageReady(cdp);
 *
 * // Custom timeout for very slow apps
 * await waitForPageReady(cdp, { maxWaitMs: 15000 });
 * ```
 */
export async function waitForPageReady(
  cdp: CDPConnection,
  options: PageReadinessOptions = {}
): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? 5000;
  const deadline = Date.now() + maxWaitMs;

  try {
    await waitForLoadEvent(cdp, deadline);
    log.info('Load event fired');

    const { networkIdleMs, domIdleMs } = await waitForQuiet(cdp, deadline);
    log.info(`Network stable (${networkIdleMs}ms idle)`);
    log.info(`DOM stable (${domIdleMs}ms idle)`);

    log.info('Page ready');
  } catch (error) {
    log.info(`${getErrorMessage(error)}, proceeding anyway`);
  }
}

/**
 * Wait for Page.loadEventFired (window.onload equivalent)
 *
 * This is the browser's native load event - fires when:
 * - Document is fully loaded
 * - All synchronous scripts executed
 * - DOMContentLoaded already fired
 *
 * Framework-agnostic baseline.
 *
 * Handles edge case where load event already fired (Chrome navigates during launch).
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @throws Error if deadline exceeded
 */
async function waitForLoadEvent(cdp: CDPConnection, deadline: number): Promise<void> {
  await cdp.send('Page.enable');

  try {
    const result = (await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })) as Protocol.Runtime.EvaluateResponse;

    if (result.result.value === 'complete') {
      return;
    }
  } catch (error) {
    log.debug(`Failed to check document.readyState: ${getErrorMessage(error)}`);
  }

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    let cleanupHandler: (() => void) | undefined;

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (cleanupHandler) {
        cleanupHandler();
      }
    };

    const checkDeadline = (): void => {
      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error('Load event timeout'));
      } else {
        timeout = setTimeout(checkDeadline, DEADLINE_CHECK_INTERVAL_MS);
      }
    };

    const loadHandler = (): void => {
      cleanup();
      resolve();
    };

    cleanupHandler = cdp.on('Page.loadEventFired', loadHandler);
    checkDeadline();
  });
}

/**
 * Page script tracking DOM mutations until {@link REMOVE_MUTATION_OBSERVER_JS}.
 * Installs only once per document: a page that navigated itself (a redirect
 * right after load) gets a new observer, its quiet time counted from then.
 */
const INSTALL_MUTATION_OBSERVER_JS = `
  if (!window.__bdg_observer) {
    window.__bdg_lastMutation = Date.now();
    window.__bdg_observer = new MutationObserver(() => {
      window.__bdg_lastMutation = Date.now();
    });
    window.__bdg_observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }
`;

const REMOVE_MUTATION_OBSERVER_JS = `
  window.__bdg_observer?.disconnect();
  delete window.__bdg_observer;
  delete window.__bdg_lastMutation;
`;

/**
 * Wait until the network and the DOM are both quiet: no request in flight
 * for 200 ms and no DOM mutation for 300 ms (hydration, client rendering,
 * lazy-loaded resources and API calls all show up in one or the other).
 *
 * Both are watched at once, so a page that is already quiet is ready after
 * 300 ms, not after 200 ms and then another 300 ms.
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @returns How long each has been quiet
 * @throws Error if deadline exceeded
 */
async function waitForQuiet(
  cdp: CDPConnection,
  deadline: number
): Promise<{ networkIdleMs: number; domIdleMs: number }> {
  await cdp.send('Network.enable');
  const requests = trackInFlightRequests(cdp);

  try {
    await cdp.send('Runtime.evaluate', { expression: INSTALL_MUTATION_OBSERVER_JS });
    while (Date.now() < deadline) {
      const networkIdleMs = requests.count === 0 ? Date.now() - requests.lastActivity : 0;
      if (networkIdleMs >= NETWORK_IDLE_THRESHOLD_MS) {
        const domIdleMs = await msSinceLastMutation(cdp);
        if (domIdleMs >= DOM_STABLE_THRESHOLD_MS) return { networkIdleMs, domIdleMs };
      }
      await delay(QUIET_CHECK_INTERVAL_MS);
    }
    throw new Error('Page stability timeout');
  } finally {
    requests.dispose();
    await cdp
      .send('Runtime.evaluate', { expression: REMOVE_MUTATION_OBSERVER_JS })
      .catch((error) => {
        log.debug(`Failed to clean up DOM observer: ${getErrorMessage(error)}`);
      });
  }
}

/**
 * Time since the page's DOM last changed.
 *
 * @param cdp - CDP connection
 * @returns Milliseconds since the last mutation (0 when unknown)
 */
async function msSinceLastMutation(cdp: CDPConnection): Promise<number> {
  const check = (await cdp.send('Runtime.evaluate', {
    expression: `${INSTALL_MUTATION_OBSERVER_JS}; Date.now() - window.__bdg_lastMutation`,
    returnByValue: true,
  })) as Protocol.Runtime.EvaluateResponse;
  const value: unknown = check.result.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
