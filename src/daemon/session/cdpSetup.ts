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
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { normalizeUrl } from '@/utils/url.js';

/**
 * Connect to the session's target over CDP.
 *
 * @param telemetryStore - Store holding the resolved target
 * @param log - Logger
 * @param onDisconnect - Called if an established connection is later lost
 * @returns Open CDP connection
 * @throws CDPConnectionError if no target is known or connecting fails
 */
export async function connectCDP(
  telemetryStore: TelemetryStore,
  log: Logger,
  onDisconnect: () => void
): Promise<CDPConnection> {
  if (!telemetryStore.targetInfo) {
    throw new CDPConnectionError('Failed to obtain target information');
  }

  const cdp = new CDPConnection(log);
  await cdp.connect(telemetryStore.targetInfo.webSocketDebuggerUrl, {
    autoReconnect: false,
    maxRetries: 10,
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
 * Navigate to the configured URL, wait for the page, and refresh target info.
 *
 * @param cdp - Open CDP connection
 * @param config - Session configuration
 * @param telemetryStore - Store whose target info is refreshed
 * @param chrome - Launched Chrome, or null when attached to an external browser
 * @param log - Logger
 */
export async function navigateToTarget(
  cdp: CDPConnection,
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  chrome: LaunchedChrome | null,
  log: Logger
): Promise<void> {
  const normalizedUrl = normalizeUrl(config.url);
  log.info(`Navigating to ${normalizedUrl}...`);
  await cdp.send('Page.navigate', { url: normalizedUrl });

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
}
