/**
 * Post-action network-stability wait.
 *
 * Used around fill/click/hover/pressKey/scroll: tracks in-flight requests
 * from before the action runs (so a request its handler sends synchronously
 * is seen), then waits until no request has been pending for
 * ACTION_NETWORK_IDLE_MS, giving up after ACTION_STABILITY_TIMEOUT_MS.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { trackInFlightRequests, type InFlightRequests } from '@/connection/inFlightRequests.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

const ACTION_NETWORK_IDLE_MS = 150;
const ACTION_STABILITY_TIMEOUT_MS = 2000;
const STABILITY_CHECK_INTERVAL_MS = 50;

/**
 * Run an action and, when it succeeds, wait for the network to settle.
 *
 * Requests are tracked from before the action, so one an event handler
 * starts while the action runs (`onclick = () => fetch(...)`) is waited for.
 * `Network.enable` is sent without waiting for it: the session's network
 * collector has already enabled the domain, and Chrome holds the call until
 * a pending navigation commits, which would otherwise block for as long as
 * the new page's server takes to answer.
 *
 * @param cdp - CDP connection
 * @param action - Action to run (its result's `success` decides whether to wait)
 * @param wait - Wait for the network after the action (false for `--no-wait`)
 * @returns The action's result, once the network is idle or the wait timed out
 */
export async function withActionStability<T extends { success: boolean }>(
  cdp: CDPConnection,
  action: () => Promise<T>,
  wait = true
): Promise<T> {
  if (!wait) return action();

  void cdp
    .send('Network.enable')
    .catch((error: unknown) => log.debug(`Network.enable failed: ${getErrorMessage(error)}`));
  const requests = trackInFlightRequests(cdp);
  try {
    const result = await action();
    if (result.success) await waitForNetworkIdle(requests);
    return result;
  } finally {
    requests.dispose();
  }
}

/**
 * Wait until no request has been in flight for ACTION_NETWORK_IDLE_MS since
 * the wait began (a request the action started counts until it ends), or
 * until ACTION_STABILITY_TIMEOUT_MS passed.
 *
 * @param requests - Tracker started before the action
 */
async function waitForNetworkIdle(requests: InFlightRequests): Promise<void> {
  const waitStart = Date.now();
  const deadline = waitStart + ACTION_STABILITY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (requests.count === 0) {
      const idleTime = Date.now() - Math.max(requests.lastActivity, waitStart);
      if (idleTime >= ACTION_NETWORK_IDLE_MS) {
        log.debug(`Network stable after ${idleTime}ms idle`);
        return;
      }
    }

    await delay(STABILITY_CHECK_INTERVAL_MS);
  }

  log.debug(`Stability timeout reached with ${requests.count} request(s) in flight, proceeding`);
}
