/**
 * Chrome Connection Setup
 *
 * Handles Chrome launch or connection to existing Chrome instance.
 * Finds the appropriate CDP target for the session.
 */

import { launchChrome } from '@/connection/launcher.js';
import type { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import type { WorkerConfig } from '@/daemon/worker/types.js';
import { writeChromePid } from '@/session/chrome.js';
import type { LaunchedChrome } from '@/types';
import type { Logger } from '@/ui/logging/index.js';
import {
  chromeExternalConnectionMessage,
  chromeExternalWebSocketMessage,
  chromeExternalNoPidMessage,
  noPageTargetFoundError,
} from '@/ui/messages/chrome.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Setup Chrome connection - either launch new instance or connect to existing.
 *
 * @returns Launched Chrome instance (null if connecting to external Chrome)
 */
export async function setupChromeConnection(
  config: WorkerConfig,
  telemetryStore: TelemetryStore,
  log: Logger
): Promise<LaunchedChrome | null> {
  if (config.chromeWsUrl) {
    return setupExternalChrome(config, telemetryStore);
  } else {
    return setupLaunchedChrome(config, telemetryStore, log);
  }
}

/**
 * Connect to existing external Chrome instance.
 */
async function setupExternalChrome(
  config: WorkerConfig,
  telemetryStore: TelemetryStore
): Promise<null> {
  console.error(`[worker] ${chromeExternalConnectionMessage()}`);
  console.error(`[worker] ${chromeExternalWebSocketMessage(config.chromeWsUrl!)}`);

  const targetId = config.chromeWsUrl!.split('/').pop() ?? 'external';

  telemetryStore.setTargetInfo({
    id: targetId,
    type: 'page',
    title: 'External Chrome',
    url: config.url,
    webSocketDebuggerUrl: config.chromeWsUrl!,
  });

  console.error(`[worker] ${chromeExternalNoPidMessage()}`);

  return null;
}

/**
 * Launch new Chrome instance and find page target.
 */
async function setupLaunchedChrome(
  config: WorkerConfig,
  telemetryStore: TelemetryStore,
  log: Logger
): Promise<LaunchedChrome> {
  console.error(`[worker] Launching Chrome on port ${config.port}...`);

  const chrome = await launchChrome({
    port: config.port,
    ...filterDefined({
      userDataDir: config.userDataDir,
      headless: config.headless,
    }),
  });

  console.error(`[worker] Chrome launched (PID ${chrome.pid})`);

  writeChromePid(chrome.pid);
  log.debug(`[worker] Chrome PID ${chrome.pid} cached for emergency cleanup`);

  // Find page target
  console.error(`[worker] Connecting to Chrome via CDP...`);
  const targets = await fetchCDPTargets(config.port);
  const foundTarget = targets.find((t) => t.type === 'page');

  if (!foundTarget) {
    const availableTargets = targets.length
      ? targets
          .map(
            (t, i) =>
              `  ${i + 1}. ${t.title || '(no title)'}\n     URL: ${t.url}\n     Type: ${t.type}`
          )
          .join('\n')
      : null;

    throw new Error(noPageTargetFoundError(config.port, availableTargets));
  }

  telemetryStore.setTargetInfo(foundTarget);
  console.error(`[worker] Found target: ${foundTarget.title} (${foundTarget.url})`);

  return chrome;
}
