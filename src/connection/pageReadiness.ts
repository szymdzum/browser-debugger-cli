/**
 * Smart page readiness detection using fixed thresholds
 *
 * This module provides page load detection that works for most page types
 * without configuration. It uses a three-phase approach:
 * 1. Load event (baseline readiness)
 * 2. Network stability (200ms idle threshold)
 * 3. DOM stability (300ms idle threshold)
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';

// Readiness Detection Thresholds
/** Network idle threshold in milliseconds - network is stable when no requests for this duration */
const NETWORK_IDLE_THRESHOLD_MS = 200;
/** DOM stable threshold in milliseconds - DOM is stable when no mutations for this duration */
const DOM_STABLE_THRESHOLD_MS = 300;
/** Interval for checking deadline expiration in milliseconds */
const DEADLINE_CHECK_INTERVAL_MS = 100;
/** Interval for checking network activity in milliseconds */
const NETWORK_CHECK_INTERVAL_MS = 50;

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
 * 2. Wait for network to stabilize (200ms idle threshold)
 * 3. Wait for DOM to stabilize (300ms idle threshold)
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
    console.error('[readiness] ✓ Load event');

    const networkIdleMs = await waitForNetworkStable(cdp, deadline);
    console.error(`[readiness] ✓ Network stable (${networkIdleMs}ms idle)`);

    const domIdleMs = await waitForDOMStable(cdp, deadline);
    console.error(`[readiness] ✓ DOM stable (${domIdleMs}ms idle)`);

    console.error('[readiness] ✓ Page ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[readiness] ${message}, proceeding anyway`);
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
    console.error(
      `[readiness] Failed to check document.readyState: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    let handlerId: number | undefined;

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (handlerId !== undefined) {
        cdp.off('Page.loadEventFired', handlerId);
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

    handlerId = cdp.on('Page.loadEventFired', loadHandler);
    checkDeadline();
  });
}

/**
 * Wait for network to stabilize
 *
 * Uses a fixed 200ms idle threshold which works well for most pages:
 * - Fast enough for quick sites (avoids unnecessary waiting)
 * - Patient enough for API-heavy apps (catches late requests)
 * - Simpler and more predictable than adaptive learning
 *
 * Network is considered stable when there are zero active requests
 * for at least 200ms continuously.
 *
 * Why this works:
 * - Catches initial request bursts (CSS, JS, images)
 * - Waits for lazy-loaded resources
 * - Detects API calls triggered by hydration
 * - Framework-agnostic - based on actual network activity
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @returns Actual idle duration detected
 * @throws Error if deadline exceeded
 */
async function waitForNetworkStable(cdp: CDPConnection, deadline: number): Promise<number> {
  await cdp.send('Network.enable');

  let activeRequests = 0;
  let lastActivity = Date.now();

  const requestHandler = (): void => {
    activeRequests++;
    lastActivity = Date.now();
  };

  const finishHandler = (): void => {
    activeRequests--;
    if (activeRequests === 0) {
      lastActivity = Date.now();
    }
  };

  const requestHandlerId = cdp.on('Network.requestWillBeSent', requestHandler);
  const loadingFinishedId = cdp.on('Network.loadingFinished', finishHandler);
  const loadingFailedId = cdp.on('Network.loadingFailed', finishHandler);

  try {
    while (Date.now() < deadline) {
      if (activeRequests === 0) {
        const idleTime = Date.now() - lastActivity;
        if (idleTime >= NETWORK_IDLE_THRESHOLD_MS) {
          return idleTime; // Success!
        }
      }

      await delay(NETWORK_CHECK_INTERVAL_MS);
    }

    throw new Error('Network stability timeout');
  } finally {
    cdp.off('Network.requestWillBeSent', requestHandlerId);
    cdp.off('Network.loadingFinished', loadingFinishedId);
    cdp.off('Network.loadingFailed', loadingFailedId);
  }
}

/**
 * Wait for DOM to stabilize
 *
 * Uses a MutationObserver to detect when the DOM stops changing.
 * DOM is considered stable when there are no mutations for 300ms continuously.
 *
 * HOW IT WORKS:
 * 1. Inject MutationObserver into page to track all DOM changes
 * 2. Monitor childList, attributes, subtree, and characterData changes
 * 3. Wait for 300ms of continuous no-change activity
 * 4. Clean up observer when complete
 *
 * Why this works:
 * - SSR hydration causes DOM mutations (React, Vue, Svelte)
 * - Client-side rendering creates DOM elements
 * - When mutations stop, framework initialization is complete
 * - 300ms is long enough to catch batched updates, short enough to be responsive
 *
 * Framework-agnostic - detects actual mutations regardless of framework.
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @returns Actual stable duration detected
 * @throws Error if deadline exceeded
 */
async function waitForDOMStable(cdp: CDPConnection, deadline: number): Promise<number> {
  await cdp.send('Runtime.evaluate', {
    expression: `
      window.__bdg_mutations = 0;
      window.__bdg_lastMutation = Date.now();

      const observer = new MutationObserver(() => {
        window.__bdg_mutations++;
        window.__bdg_lastMutation = Date.now();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      window.__bdg_observer = observer;
    `,
  });

  try {
    while (Date.now() < deadline) {
      const checkResult = (await cdp.send('Runtime.evaluate', {
        expression: 'Date.now() - window.__bdg_lastMutation',
        returnByValue: true,
      })) as Protocol.Runtime.EvaluateResponse;

      const timeSinceLastMutation = (checkResult.result.value as number) ?? 0;

      if (timeSinceLastMutation >= DOM_STABLE_THRESHOLD_MS) {
        return timeSinceLastMutation; // Success!
      }

      await delay(DEADLINE_CHECK_INTERVAL_MS);
    }

    throw new Error('DOM stability timeout');
  } finally {
    await cdp
      .send('Runtime.evaluate', {
        expression: `
        window.__bdg_observer?.disconnect();
        delete window.__bdg_observer;
        delete window.__bdg_mutations;
        delete window.__bdg_lastMutation;
      `,
      })
      .catch(() => {});
  }
}

/**
 * Delay utility
 *
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
