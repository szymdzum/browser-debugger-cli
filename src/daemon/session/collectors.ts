import type { TelemetryStore } from './TelemetryStore.js';
import type { TelemetryPlugin } from './plugins.js';
import type { SessionConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { sessionActivatingCollector, sessionCollectorsActivated } from '@/daemon/messages.js';
import type { CleanupFunction, TelemetryType } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';

import { getRegisteredTelemetryPlugins, shouldActivatePlugin } from './plugins.js';

const DEFAULT_TELEMETRY: TelemetryType[] = ['network', 'console', 'dom'];

export async function startTelemetryCollectors(
  cdp: CDPConnection,
  config: SessionConfig,
  store: TelemetryStore,
  logger: Logger,
  plugins?: TelemetryPlugin[]
): Promise<CleanupFunction[]> {
  const cleanupFunctions: CleanupFunction[] = [];
  store.activeTelemetry = config.telemetry ?? DEFAULT_TELEMETRY;
  const effectivePlugins = plugins ?? getRegisteredTelemetryPlugins();

  for (const plugin of effectivePlugins) {
    if (!shouldActivatePlugin(plugin, store)) {
      continue;
    }
    logger.debug(sessionActivatingCollector(plugin.name));
    const cleanup = await plugin.start({ cdp, config, store, logger });
    cleanupFunctions.push(cleanup);
  }

  logger.debug(sessionCollectorsActivated(store.activeTelemetry));
  return cleanupFunctions;
}
