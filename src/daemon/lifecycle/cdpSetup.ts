/**
 * CDP Setup and Navigation
 *
 * Handles CDP connection, telemetry activation, and page navigation.
 */

import { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError } from '@/connection/errors.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import type { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { startTelemetryCollectors } from '@/daemon/worker/collectors.js';
import type { WorkerConfig } from '@/daemon/worker/types.js';
import type { CleanupFunction, LaunchedChrome } from '@/types';
import type { Logger } from '@/ui/logging/index.js';
import { workerExitingConnectionLoss } from '@/ui/messages/debug.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { normalizeUrl } from '@/utils/url.js';

/**
 * CDP setup result.
 */
export interface CDPSetupResult {
  cdp: CDPConnection;
  cleanupFunctions: CleanupFunction[];
}

/**
 * Setup CDP connection, activate telemetry, and navigate to target URL.
 *
 * @param onDisconnect - Callback for when CDP connection is lost
 */
export async function setupCDPAndNavigate(
  config: WorkerConfig,
  telemetryStore: TelemetryStore,
  chrome: LaunchedChrome | null,
  log: Logger,
  onDisconnect: () => void
): Promise<CDPSetupResult> {
  if (!telemetryStore.targetInfo) {
    throw new CDPConnectionError('Failed to obtain target information');
  }

  // Connect to CDP (inject logger for structured logging)
  const cdp = new CDPConnection(log);
  await cdp.connect(telemetryStore.targetInfo.webSocketDebuggerUrl, {
    autoReconnect: false,
    maxRetries: 10,
    onDisconnect: (code, reason) => {
      log.info(`Chrome connection lost (code: ${code}, reason: ${reason})`);
      log.debug(workerExitingConnectionLoss());
      onDisconnect();
    },
  });
  log.info('CDP connection established');

  // Activate telemetry collectors BEFORE navigation
  console.error(`[worker] Activating collectors before navigation...`);
  const cleanupFunctions = await startTelemetryCollectors(cdp, config, telemetryStore, log);
  console.error(`[worker] Collectors active and ready to capture telemetry`);

  // Navigate to target URL
  const normalizedUrl = normalizeUrl(config.url);
  console.error(`[worker] Navigating to ${normalizedUrl}...`);
  await cdp.send('Page.navigate', { url: normalizedUrl });

  await waitForPageReady(cdp, {
    maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
  });
  console.error(`[worker] Page ready`);

  // Update target info after navigation
  if (chrome && telemetryStore.targetInfo) {
    const currentTargetId = telemetryStore.targetInfo.id;
    const updatedTargets = await fetchCDPTargets(config.port);
    const updatedTarget = updatedTargets.find((t) => t.id === currentTargetId);
    if (updatedTarget) {
      telemetryStore.setTargetInfo(updatedTarget);
      console.error(`[worker] Target updated: ${updatedTarget.title} (${updatedTarget.url})`);
    }
  }

  return { cdp, cleanupFunctions };
}
