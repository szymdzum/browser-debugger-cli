/**
 * Smart page readiness detection using self-tuning thresholds
 *
 * This module provides adaptive page load detection that works for any page type
 * without configuration. It uses a three-phase approach:
 * 1. Load event (baseline readiness)
 * 2. Network stability (adapts to request patterns)
 * 3. DOM stability (adapts to mutation rate)
 *
 * @module utils/pageReadiness
 */

import type { CDPConnection } from '@/connection/cdp.js';

/**
 * Options for page readiness detection
 */
export interface PageReadinessOptions {
  /**
   * Maximum wait time before proceeding anyway
   * Default: 30000ms (30 seconds)
   */
  maxWaitMs?: number;
}

/**
 * Wait for page to be ready using self-tuning detection
 *
 * Strategy:
 * 1. Wait for load event (baseline)
 * 2. Wait for network to stabilize (adaptive)
 * 3. Wait for DOM to stabilize (adaptive)
 *
 * All thresholds adapt to observed page behavior.
 * No framework detection, no configuration needed.
 *
 * @param cdp - CDP connection
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * // Default: Self-tuning for any page
 * await waitForPageReady(cdp);
 *
 * // Custom timeout for slow apps
 * await waitForPageReady(cdp, { maxWaitMs: 60000 });
 * ```
 */
export async function waitForPageReady(
  cdp: CDPConnection,
  options: PageReadinessOptions = {}
): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? 30000;
  const deadline = Date.now() + maxWaitMs;

  try {
    // Phase 1: Wait for load event
    await waitForLoadEvent(cdp, deadline);
    console.error('[readiness] ✓ Load event');

    // Phase 2: Wait for network to stabilize (adaptive)
    const networkIdleMs = await waitForNetworkStable(cdp, deadline);
    console.error(`[readiness] ✓ Network stable (${networkIdleMs}ms idle)`);

    // Phase 3: Wait for DOM to stabilize (adaptive)
    const domIdleMs = await waitForDOMStable(cdp, deadline);
    console.error(`[readiness] ✓ DOM stable (${domIdleMs}ms idle)`);

    console.error('[readiness] ✓ Page ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[readiness] ${message}, proceeding anyway`);
    // Don't rethrow - allow session to continue
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

  // Check if page already loaded (handles Chrome pre-navigation)
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });

    if ((result as { result?: { value?: string } }).result?.value === 'complete') {
      // Load event already fired
      return;
    }
  } catch {
    // Ignore evaluation errors, proceed to wait for event
  }

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    let handlerId: number | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      if (handlerId !== undefined) {
        cdp.off('Page.loadEventFired', handlerId);
      }
    };

    const checkDeadline = () => {
      if (Date.now() >= deadline) {
        cleanup();
        reject(new Error('Load event timeout'));
      } else {
        timeout = setTimeout(checkDeadline, 100);
      }
    };

    const loadHandler = () => {
      cleanup();
      resolve();
    };

    handlerId = cdp.on('Page.loadEventFired', loadHandler);
    checkDeadline();
  });
}

/**
 * Wait for network to stabilize using adaptive thresholds
 *
 * LEARNING PHASE (first 2s):
 * - Track request intervals
 * - Calculate average request frequency
 *
 * DETECTION PHASE:
 * - Fast pattern (avg < 100ms): 200ms idle = stable
 * - Steady pattern (100-500ms): 500ms idle = stable
 * - Slow pattern (> 500ms): 1000ms idle = stable
 *
 * Why this works:
 * - Fast sites: Quick bursts, fast stabilization
 * - SSR apps: Steady hydration requests, medium wait
 * - API-heavy: Slow requests, longer patience
 *
 * Framework-agnostic - adapts to actual behavior.
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
  const intervals: number[] = [];
  let lastRequestTime = Date.now();

  // Track request patterns
  const requestHandler = () => {
    const now = Date.now();
    const interval = now - lastRequestTime;
    if (interval < 5000) intervals.push(interval);
    lastRequestTime = now;
    activeRequests++;
    lastActivity = now;
  };

  const finishHandler = () => {
    activeRequests--;
    if (activeRequests === 0) {
      lastActivity = Date.now();
    }
  };

  const requestHandlerId = cdp.on('Network.requestWillBeSent', requestHandler);
  const loadingFinishedId = cdp.on('Network.loadingFinished', finishHandler);
  const loadingFailedId = cdp.on('Network.loadingFailed', finishHandler);

  try {
    // Learning phase: gather samples
    const learningMs = Math.min(2000, deadline - Date.now());
    await delay(learningMs);

    // Calculate adaptive threshold
    const avgInterval =
      intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 500;

    const idleThreshold = avgInterval < 100 ? 200 : avgInterval < 500 ? 500 : 1000;

    // Detection phase: wait for stability
    while (Date.now() < deadline) {
      if (activeRequests === 0) {
        const idleTime = Date.now() - lastActivity;
        if (idleTime >= idleThreshold) {
          return idleTime; // Success!
        }
      }

      await delay(50); // Check every 50ms
    }

    throw new Error('Network stability timeout');
  } finally {
    // Cleanup handlers
    cdp.off('Network.requestWillBeSent', requestHandlerId);
    cdp.off('Network.loadingFinished', loadingFinishedId);
    cdp.off('Network.loadingFailed', loadingFailedId);
  }
}

/**
 * Wait for DOM to stabilize using adaptive thresholds
 *
 * HOW IT WORKS:
 * 1. Inject MutationObserver into page
 * 2. Track mutation rate for 1 second
 * 3. Calculate adaptive stability threshold:
 *    - High rate (>50/sec): 1000ms no-change = stable
 *    - Medium rate (10-50/sec): 500ms no-change = stable
 *    - Low rate (<10/sec): 300ms no-change = stable
 * 4. Wait for DOM to remain unchanged for threshold duration
 *
 * Why this works:
 * - SSR hydration causes DOM mutations
 * - React/Vue/Svelte all mutate during hydration
 * - When mutations stop, hydration is complete
 *
 * Framework-agnostic - detects actual mutations.
 *
 * @param cdp - CDP connection
 * @param deadline - Timestamp when to timeout
 * @returns Actual stable duration detected
 * @throws Error if deadline exceeded
 */
async function waitForDOMStable(cdp: CDPConnection, deadline: number): Promise<number> {
  // Inject mutation observer
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
    // Learning phase: measure mutation rate
    const learningMs = Math.min(1000, deadline - Date.now());
    await delay(learningMs);

    const result = await cdp.send('Runtime.evaluate', {
      expression: 'window.__bdg_mutations',
      returnByValue: true,
    });

    const mutationCount = (result as { result?: { value?: number } }).result?.value ?? 0;
    const mutationRate = mutationCount / (learningMs / 1000);

    // Calculate adaptive threshold
    const stableThreshold = mutationRate > 50 ? 1000 : mutationRate > 10 ? 500 : 300;

    // Detection phase: wait for stability
    while (Date.now() < deadline) {
      const checkResult = await cdp.send('Runtime.evaluate', {
        expression: 'Date.now() - window.__bdg_lastMutation',
        returnByValue: true,
      });

      const timeSinceLastMutation =
        (checkResult as { result?: { value?: number } }).result?.value ?? 0;

      if (timeSinceLastMutation >= stableThreshold) {
        return timeSinceLastMutation; // Success!
      }

      await delay(100); // Check every 100ms
    }

    throw new Error('DOM stability timeout');
  } finally {
    // Cleanup observer
    await cdp
      .send('Runtime.evaluate', {
        expression: `
        window.__bdg_observer?.disconnect();
        delete window.__bdg_observer;
        delete window.__bdg_mutations;
        delete window.__bdg_lastMutation;
      `,
      })
      .catch(() => {
        // Ignore cleanup errors
      });
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
