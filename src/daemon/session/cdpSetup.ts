/**
 * CDP Setup and Navigation
 *
 * Handles CDP connection and page navigation for a session.
 */

import { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError } from '@/connection/errors.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import { sessionEndingConnectionLoss } from '@/daemon/messages.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { CommandError } from '@/errors/index.js';
import { navigationFailedError } from '@/errors/messages.js';
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { normalizeUrl } from '@/utils/url.js';

/** Connection attempts for a Chrome bdg launched (it may still be starting) */
const LAUNCHED_CONNECT_ATTEMPTS = 10;

/** Connection attempts for an external Chrome (already running) */
const EXTERNAL_CONNECT_ATTEMPTS = 2;

/**
 * Connect to the session's target over CDP.
 *
 * @param telemetryStore - Store holding the resolved target
 * @param log - Logger
 * @param onDisconnect - Called if an established connection is later lost
 * @param options - `external`: an already running Chrome, so a failed connect is
 *   not retried for long (a launched Chrome may still be starting)
 * @returns Open CDP connection
 * @throws CDPConnectionError if no target is known or connecting fails
 */
export async function connectCDP(
  telemetryStore: TelemetryStore,
  log: Logger,
  onDisconnect: () => void,
  options: { external?: boolean } = {}
): Promise<CDPConnection> {
  if (!telemetryStore.targetInfo) {
    throw new CDPConnectionError('Failed to obtain target information');
  }

  const cdp = new CDPConnection(log);
  await cdp.connect(telemetryStore.targetInfo.webSocketDebuggerUrl, {
    autoReconnect: false,
    maxRetries: options.external ? EXTERNAL_CONNECT_ATTEMPTS : LAUNCHED_CONNECT_ATTEMPTS,
    onDisconnect: (code, reason) => {
      log.info(`Chrome connection lost (code: ${code}, reason: ${reason})`);
      log.debug(sessionEndingConnectionLoss());
      onDisconnect();
    },
  });
  log.info('CDP connection established');
  return cdp;
}

/**
 * Network errors that mean the start URL could not be reached at all.
 *
 * Other `Page.navigate` errors still leave a page worth inspecting: HTTP error
 * pages with an empty body (`ERR_HTTP_RESPONSE_CODE_FAILURE`), downloads and
 * 204 responses (`ERR_ABORTED`), certificate interstitials (`ERR_CERT_*`).
 */
const UNREACHABLE_ERRORS =
  /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_CONNECTION_(REFUSED|RESET|CLOSED|FAILED|TIMED_OUT)|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_FILE_NOT_FOUND|ERR_UNSAFE_PORT|ERR_INVALID_URL/;

/**
 * Navigate to the configured URL, wait for the page, and refresh target info.
 *
 * @param cdp - Open CDP connection
 * @param config - Session configuration
 * @param telemetryStore - Store whose target info is refreshed
 * @param chrome - Launched Chrome, or null when attached to an external browser
 * @param log - Logger
 * @returns Loader id of the navigation (the main document's request id)
 * @throws CommandError (80) when the URL cannot be reached at all
 */
export async function navigateToTarget(
  cdp: CDPConnection,
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  chrome: LaunchedChrome | null,
  log: Logger
): Promise<string | undefined> {
  const normalizedUrl = normalizeUrl(config.url);
  log.info(`Navigating to ${normalizedUrl}...`);
  const navigation = (await cdp.send('Page.navigate', { url: normalizedUrl })) as {
    loaderId?: string;
    errorText?: string;
  };
  if (navigation.errorText && UNREACHABLE_ERRORS.test(navigation.errorText)) {
    const err = navigationFailedError(normalizedUrl, navigation.errorText);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_URL);
  }
  if (navigation.errorText) log.info(`Navigation reported ${navigation.errorText}`);

  await waitForPageReady(cdp, {
    maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
  });
  log.info(`Page ready`);

  if (chrome && telemetryStore.targetInfo) {
    const currentTargetId = telemetryStore.targetInfo.id;
    const updatedTargets = await fetchCDPTargets(config.port, log);
    const updatedTarget = updatedTargets.find((t) => t.id === currentTargetId);
    if (updatedTarget) {
      telemetryStore.setTargetInfo(updatedTarget);
      log.info(`Target updated: ${updatedTarget.title} (${updatedTarget.url})`);
    }
  }
  return navigation.loaderId;
}
