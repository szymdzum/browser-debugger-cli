/**
 * Post-action network-stability wait.
 *
 * Lightweight check used after fill/click/pressKey/scroll: subscribes to
 * CDP network events, waits until no request has been pending for
 * ACTION_NETWORK_IDLE_MS, times out at ACTION_STABILITY_TIMEOUT_MS.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';

const log = createLogger('dom');

const ACTION_NETWORK_IDLE_MS = 150;
const ACTION_STABILITY_TIMEOUT_MS = 2000;
const STABILITY_CHECK_INTERVAL_MS = 50;

/**
 * Wait for the network to settle after an action. Returns when idle for
 * the threshold or after the timeout.
 */
export async function waitForActionStability(cdp: CDPConnection): Promise<void> {
  const deadline = Date.now() + ACTION_STABILITY_TIMEOUT_MS;

  let activeRequests = 0;
  let lastActivity = Date.now();

  const onRequestStarted = (): void => {
    activeRequests++;
    lastActivity = Date.now();
  };

  const onRequestFinished = (): void => {
    activeRequests--;
    if (activeRequests === 0) {
      lastActivity = Date.now();
    }
  };

  await cdp.send('Network.enable');

  const cleanupRequest = cdp.on('Network.requestWillBeSent', onRequestStarted);
  const cleanupFinished = cdp.on('Network.loadingFinished', onRequestFinished);
  const cleanupFailed = cdp.on('Network.loadingFailed', onRequestFinished);

  try {
    while (Date.now() < deadline) {
      if (activeRequests === 0) {
        const idleTime = Date.now() - lastActivity;
        if (idleTime >= ACTION_NETWORK_IDLE_MS) {
          log.debug(`Network stable after ${idleTime}ms idle`);
          return;
        }
      }

      await delay(STABILITY_CHECK_INTERVAL_MS);
    }

    log.debug('Stability timeout reached, proceeding');
  } finally {
    cleanupRequest();
    cleanupFinished();
    cleanupFailed();
  }
}
