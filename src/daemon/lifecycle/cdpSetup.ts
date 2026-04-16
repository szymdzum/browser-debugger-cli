/**
 * CDP Setup and Navigation
 *
 * Handles CDP connection, telemetry activation, and page navigation.
 */

import { CDPConnection } from '@/connection/cdp.js';
import { CDPConnectionError } from '@/connection/errors.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { DEFAULT_PAGE_READINESS_TIMEOUT_MS } from '@/constants.js';
import { workerExitingConnectionLoss } from '@/daemon/messages.js';
import type { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { startTelemetryCollectors } from '@/daemon/worker/collectors.js';
import type { WorkerConfig } from '@/daemon/worker/types.js';
import type { CleanupFunction, LaunchedChrome } from '@/types';
import type { Logger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { normalizeUrl } from '@/utils/url.js';

/**
 * Thrown when Chrome failed to navigate to the target URL (DNS failure,
 * connection refused, SSL error, etc.). Carries exit code 91 so the CLI
 * reports NAVIGATION_FAILED instead of silently reporting success.
 */
export class NavigationFailedError extends Error {
  public readonly exitCode = EXIT_CODES.NAVIGATION_FAILED;
  constructor(
    url: string,
    public readonly errorText: string
  ) {
    super(`Navigation to ${url} failed: ${errorText}`);
    this.name = 'NavigationFailedError';
  }
}

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

  console.error(`[worker] Activating collectors before navigation...`);
  const cleanupFunctions = await startTelemetryCollectors(cdp, config, telemetryStore, log);
  console.error(`[worker] Collectors active and ready to capture telemetry`);

  const normalizedUrl = normalizeUrl(config.url);
  console.error(`[worker] Navigating to ${normalizedUrl}...`);
  const navResponse = (await cdp.send('Page.navigate', { url: normalizedUrl })) as
    | Protocol.Page.NavigateResponse
    | undefined;
  // Chrome populates `errorText` when the main-frame navigation fails
  // (unreachable host, DNS failure, SSL error, etc.). Surface it as a
  // dedicated error so the CLI exits NAVIGATION_FAILED (91) rather than
  // reporting "Session started" on a chrome-error:// page.
  if (navResponse?.errorText) {
    throw new NavigationFailedError(normalizedUrl, navResponse.errorText);
  }

  await waitForPageReady(cdp, {
    maxWaitMs: DEFAULT_PAGE_READINESS_TIMEOUT_MS,
  });
  console.error(`[worker] Page ready`);

  if (chrome && telemetryStore.targetInfo) {
    const currentTargetId = telemetryStore.targetInfo.id;
    const updatedTargets = await fetchCDPTargets(config.port, log);
    const updatedTarget = updatedTargets.find((t) => t.id === currentTargetId);
    if (updatedTarget) {
      telemetryStore.setTargetInfo(updatedTarget);
      console.error(`[worker] Target updated: ${updatedTarget.title} (${updatedTarget.url})`);
    }
  }

  return { cdp, cleanupFunctions };
}
