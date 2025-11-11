import type { TelemetryStore } from './TelemetryStore.js';
import type { TelemetryPlugin } from './plugins.js';
import type { WorkerConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type { CleanupFunction, TelemetryType } from '@/types';
import type { Logger } from '@/ui/logging/index.js';
import { workerActivatingCollector, workerCollectorsActivated } from '@/ui/messages/debug.js';

import { createDefaultTelemetryPlugins, shouldActivatePlugin } from './plugins.js';

const DEFAULT_TELEMETRY: TelemetryType[] = ['network', 'console', 'dom'];

export async function startTelemetryCollectors(
  cdp: CDPConnection,
  config: WorkerConfig,
  store: TelemetryStore,
  logger: Logger,
  plugins: TelemetryPlugin[] = createDefaultTelemetryPlugins()
): Promise<CleanupFunction[]> {
  const cleanupFunctions: CleanupFunction[] = [];
  store.activeTelemetry = config.telemetry ?? DEFAULT_TELEMETRY;

  for (const plugin of plugins) {
    if (!shouldActivatePlugin(plugin, store)) {
      continue;
    }
    logger.debug(workerActivatingCollector(plugin.name));
    const cleanup = await plugin.start({ cdp, config, store, logger });
    cleanupFunctions.push(cleanup);
  }

  logger.debug(workerCollectorsActivated(store.activeTelemetry));
  return cleanupFunctions;
}
