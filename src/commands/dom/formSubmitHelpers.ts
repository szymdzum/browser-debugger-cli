/**
 * Form submission helpers with smart network waiting.
 */

import type { ClickResult } from './reactEventHelpers.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError, CDPTimeoutError } from '@/connection/errors.js';

import { clickElement } from './formFillHelpers.js';

/**
 * Options for submitting a form.
 */
export interface SubmitOptions {
  /** Element index if selector matches multiple (0-based) */
  index?: number;
  /** Wait for page navigation after submit (default: false) */
  waitNavigation?: boolean;
  /** Wait for network idle after submit in milliseconds (default: 1000) */
  waitNetwork?: number;
  /** Maximum time to wait in milliseconds (default: 10000) */
  timeout?: number;
}

/**
 * Result of form submission.
 */
export interface SubmitResult {
  success: boolean;
  error?: string;
  selector?: string;
  clicked?: boolean;
  networkRequests?: number;
  navigationOccurred?: boolean;
  waitTimeMs?: number;
  suggestion?: string;
}

/**
 * Submit a form by clicking the submit button and waiting for completion.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector for submit button
 * @param options - Submit options
 * @returns Promise resolving to submit result
 *
 * @throws CDPTimeoutError When timeout is reached
 * @throws CDPConnectionError When CDP communication fails
 *
 * @example
 * ```typescript
 * // Submit and wait for network idle
 * const result = await submitForm(cdp, 'button[type="submit"]', {
 *   waitNetwork: 1000,
 *   timeout: 10000
 * });
 * ```
 *
 * @remarks
 * This function:
 * 1. Clicks the submit button
 * 2. Monitors network activity
 * 3. Waits for network idle (no requests for N ms)
 * 4. Optionally waits for page navigation
 */
export async function submitForm(
  cdp: CDPConnection,
  selector: string,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  const { index, waitNavigation = false, waitNetwork = 1000, timeout = 10000 } = options;

  const startTime = Date.now();

  const clickOptions: { index?: number } = {};
  if (index !== undefined) {
    clickOptions.index = index;
  }
  const clickResult: ClickResult = await clickElement(cdp, selector, clickOptions);

  if (!clickResult.success) {
    return {
      success: false,
      error: clickResult.error ?? 'Click failed',
      selector: clickResult.selector ?? selector,
      clicked: false,
    };
  }

  if (waitNetwork === 0 && !waitNavigation) {
    return {
      success: true,
      selector: selector,
      clicked: true,
      networkRequests: 0,
      navigationOccurred: false,
      waitTimeMs: Date.now() - startTime,
    };
  }

  try {
    const waitResult = await waitForCompletion(cdp, {
      waitNavigation,
      waitNetwork,
      timeout,
    });

    return {
      success: true,
      selector: selector,
      clicked: true,
      networkRequests: waitResult.networkRequests,
      navigationOccurred: waitResult.navigationOccurred,
      waitTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof CDPTimeoutError) {
      return {
        success: false,
        error: `Timeout waiting for form submission to complete (${timeout}ms)`,
        selector: selector,
        clicked: true,
        waitTimeMs: Date.now() - startTime,
      };
    }
    throw error;
  }
}

/**
 * Wait for form submission to complete (network idle and/or navigation).
 *
 * @param cdp - CDP connection
 * @param options - Wait options
 * @returns Promise resolving to wait result
 *
 * @throws CDPTimeoutError When timeout is reached
 *
 * @internal
 */
async function waitForCompletion(
  cdp: CDPConnection,
  options: {
    waitNavigation: boolean;
    waitNetwork: number;
    timeout: number;
  }
): Promise<{ networkRequests: number; navigationOccurred: boolean }> {
  const { waitNavigation, waitNetwork, timeout } = options;

  let activeRequests = 0;
  let networkRequests = 0;
  let navigationOccurred = false;
  let idleTimeout: NodeJS.Timeout | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;

  return new Promise((resolve, reject) => {
    const cleanupFunctions: Array<() => void> = [];

    timeoutHandle = setTimeout(() => {
      cleanup();
      reject(
        new CDPTimeoutError(
          'Wait for completion timed out',
          new Error(`Timeout after ${timeout}ms`)
        )
      );
    }, timeout);

    const checkCompletion = (): void => {
      const networkIdle = waitNetwork === 0 || activeRequests === 0;
      const navigationComplete = !waitNavigation || navigationOccurred;

      if (networkIdle && navigationComplete) {
        cleanup();
        resolve({ networkRequests, navigationOccurred });
      }
    };

    const onRequestStarted = (): void => {
      networkRequests++;
      activeRequests++;
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
    };

    const onRequestFinished = (): void => {
      activeRequests--;
      if (activeRequests === 0 && waitNetwork > 0) {
        idleTimeout = setTimeout(() => {
          checkCompletion();
        }, waitNetwork);
      }
    };

    const onNavigated = (): void => {
      navigationOccurred = true;
      checkCompletion();
    };

    cleanupFunctions.push(cdp.on('Network.requestWillBeSent', onRequestStarted));
    cleanupFunctions.push(cdp.on('Network.loadingFinished', onRequestFinished));
    cleanupFunctions.push(cdp.on('Network.loadingFailed', onRequestFinished));

    if (waitNavigation) {
      cleanupFunctions.push(cdp.on('Page.frameNavigated', onNavigated));
    }

    cdp.send('Network.enable').catch((error: Error) => {
      cleanup();
      reject(new CDPConnectionError('Failed to enable network monitoring', error));
    });

    if (waitNetwork === 0 || activeRequests === 0) {
      idleTimeout = setTimeout(() => {
        checkCompletion();
      }, waitNetwork);
    }

    function cleanup(): void {
      if (idleTimeout) clearTimeout(idleTimeout);
      if (timeoutHandle) clearTimeout(timeoutHandle);

      cleanupFunctions.forEach((cleanup) => cleanup());
    }
  });
}
