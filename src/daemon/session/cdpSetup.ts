/**
 * CDP Setup and Navigation
 *
 * Handles CDP connection and page navigation for a session.
 */

import { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError } from '@/connection/errors.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import { sendTyped, type Protocol } from '@/connection/typed-cdp.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { assertNavigated, failedLoadError } from '@/runtime/page/failedLoad.js';
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { displayUrl } from '@/utils/displayUrl.js';
import { getErrorMessage } from '@/utils/errors.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { normalizeUrl } from '@/utils/url.js';

/** How long to wait for Chrome to answer `Page.stopLoading` (the teardown follows anyway) */
const STOP_LOADING_REPLY_MS = 500;

/** Connection attempts for a Chrome bdg launched (it may still be starting) */
const LAUNCHED_CONNECT_ATTEMPTS = 10;

/** Connection attempts for an external Chrome (already running) */
const EXTERNAL_CONNECT_ATTEMPTS = 2;

/**
 * Connect to the session's target over CDP.
 *
 * @param telemetryStore - Store holding the resolved target
 * @param log - Logger
 * @param onDisconnect - Called with the connection if it is later lost
 * @param options - `external`: an already running Chrome, so a failed connect is
 *   not retried for long (a launched Chrome may still be starting); `signal`:
 *   stops retrying when the session is stopped while starting
 * @returns Open CDP connection
 * @throws CDPConnectionError if no target is known or connecting fails
 */
export async function connectCDP(
  telemetryStore: TelemetryStore,
  log: Logger,
  onDisconnect: (cdp: CDPConnection) => void,
  options: { external?: boolean; signal?: AbortSignal } = {}
): Promise<CDPConnection> {
  if (!telemetryStore.targetInfo) {
    throw new CDPConnectionError('Failed to obtain target information');
  }
  return connectPage(telemetryStore.targetInfo.webSocketDebuggerUrl, log, onDisconnect, {
    ...options,
    attempts: options.external ? EXTERNAL_CONNECT_ATTEMPTS : LAUNCHED_CONNECT_ATTEMPTS,
  });
}

/**
 * Connect to a page over CDP: the session's first tab, or one that
 * `bdg page switch` moves to (Chrome is running then, so few attempts).
 *
 * @param wsUrl - The page's DevTools WebSocket URL
 * @param log - Logger
 * @param onDisconnect - Called with the connection if it is later lost
 * @param options - Connection attempts (default 2); `signal` stops retrying
 * @returns Open CDP connection
 * @throws CDPConnectionError if connecting fails
 */
export async function connectPage(
  wsUrl: string,
  log: Logger,
  onDisconnect: (cdp: CDPConnection) => void,
  options: { attempts?: number; signal?: AbortSignal } = {}
): Promise<CDPConnection> {
  const cdp = new CDPConnection(log);
  await cdp.connect(wsUrl, {
    maxRetries: options.attempts ?? EXTERNAL_CONNECT_ATTEMPTS,
    signal: options.signal,
    onDisconnect: (code, reason) => {
      log.info(`Chrome connection lost (code: ${code}, reason: ${reason})`);
      onDisconnect(cdp);
    },
  });
  log.info('CDP connection established');
  return cdp;
}

/**
 * Navigate to the configured URL, wait for the page, and refresh target info.
 *
 * @param cdp - Open CDP connection
 * @param config - Session configuration
 * @param telemetryStore - Store whose target info is refreshed
 * @param chrome - Launched Chrome, or null when attached to an external browser
 * @param log - Logger
 * @param signal - The session's stop signal: ends the wait for Chrome's answer
 *   to `Page.navigate` (sent only once the page's first response arrives) and
 *   the readiness wait early
 * @returns Loader id of the navigation (the main document's request id)
 * @throws CommandError (80) when the load fails: Chrome's error page (any
 *   network error but those `navigationOutcome` keeps) or a main
 *   document cut off after it committed
 */
export async function navigateToTarget(
  cdp: CDPConnection,
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  chrome: LaunchedChrome | null,
  log: Logger,
  signal?: AbortSignal
): Promise<string | undefined> {
  const normalizedUrl = normalizeUrl(config.url);
  const failedBefore = telemetryStore.failedLoad;
  log.info(`Navigating to ${displayUrl(normalizedUrl)}...`);
  const navigation = await sendNavigate(cdp, normalizedUrl, log, signal);
  const addedScheme = normalizedUrl === `http://${config.url}`;
  assertNavigated(navigation, normalizedUrl, addedScheme);
  if (navigation.errorText) log.info(`Navigation reported ${navigation.errorText}`);

  await waitForPageReady(cdp, {
    maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
    ...(signal && { signal }),
  });
  log.info(`Page ready`);
  const failedNow = telemetryStore.failedLoad;
  if (failedNow && failedNow !== failedBefore && !signal?.aborted) {
    throw failedLoadError(failedNow, addedScheme);
  }

  if (chrome && telemetryStore.targetInfo && !signal?.aborted) {
    const currentTargetId = telemetryStore.targetInfo.id;
    const updatedTargets = await fetchCDPTargets(config.port, log);
    const updatedTarget = updatedTargets.find((t) => t.id === currentTargetId);
    if (updatedTarget) {
      telemetryStore.setTargetInfo(updatedTarget);
      log.info(`Target updated: ${updatedTarget.title} (${displayUrl(updatedTarget.url)})`);
    }
  }
  return navigation.loaderId;
}

/**
 * Send `Page.navigate` and wait for Chrome's answer, which comes only once
 * the page's first response arrives. A stop meanwhile ends the wait at once
 * and cancels the navigation with `Page.stopLoading`: while it is pending,
 * Chrome holds the page's other commands (`Runtime.evaluate`,
 * `Network.disable`, ...), so the teardown's would wait for the page too.
 *
 * @param cdp - Open CDP connection
 * @param url - URL to navigate to
 * @param log - Logger
 * @param signal - The session's stop signal
 * @returns Chrome's answer
 * @throws The signal's reason when it aborts first
 */
async function sendNavigate(
  cdp: CDPConnection,
  url: string,
  log: Logger,
  signal: AbortSignal | undefined
): Promise<Protocol.Page.NavigateResponse> {
  const cancelNavigation = (): void => {
    cdp
      .send('Page.stopLoading', {}, undefined, AbortSignal.timeout(STOP_LOADING_REPLY_MS))
      .catch((error: unknown) => {
        log.debug(`Page.stopLoading failed: ${getErrorMessage(error)}`);
      });
  };
  signal?.addEventListener('abort', cancelNavigation, { once: true });
  try {
    return await sendTyped(cdp, 'Page.navigate', { url }, { signal });
  } finally {
    signal?.removeEventListener('abort', cancelNavigation);
  }
}
