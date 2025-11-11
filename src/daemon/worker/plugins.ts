import type { TelemetryStore } from './TelemetryStore.js';
import type { WorkerConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { startConsoleCollection } from '@/telemetry/console.js';
import { startDialogHandling } from '@/telemetry/dialogs.js';
import { prepareDOMCollection } from '@/telemetry/dom.js';
import { startNavigationTracking } from '@/telemetry/navigation.js';
import { startNetworkCollection } from '@/telemetry/network.js';
import type { CleanupFunction, TelemetryType } from '@/types';
import type { Logger } from '@/ui/logging/index.js';
import { filterDefined } from '@/utils/objects.js';

export interface TelemetryPlugin {
  name: string;
  runAlways?: boolean;
  telemetry?: TelemetryType;
  start: (ctx: TelemetryPluginContext) => Promise<CleanupFunction>;
}

export interface TelemetryPluginContext {
  cdp: CDPConnection;
  config: WorkerConfig;
  store: TelemetryStore;
  logger: Logger;
}

export function createDefaultTelemetryPlugins(): TelemetryPlugin[] {
  return [
    {
      name: 'dialogs',
      runAlways: true,
      async start({ cdp }) {
        return startDialogHandling(cdp);
      },
    },
    {
      name: 'navigation',
      runAlways: true,
      async start({ cdp, store }) {
        const { cleanup, getCurrentNavigationId } = await startNavigationTracking(
          cdp,
          store.navigationEvents
        );
        store.setNavigationResolver(getCurrentNavigationId);
        return cleanup;
      },
    },
    {
      name: 'network',
      telemetry: 'network',
      async start({ cdp, config, store }) {
        const networkOptions = {
          includeAll: config.includeAll ?? false,
          getCurrentNavigationId: store.getCurrentNavigationId ?? undefined,
          ...filterDefined({
            maxBodySize: config.maxBodySize,
          }),
        };
        return startNetworkCollection(cdp, store.networkRequests, networkOptions);
      },
    },
    {
      name: 'console',
      telemetry: 'console',
      async start({ cdp, config, store }) {
        return startConsoleCollection(
          cdp,
          store.consoleMessages,
          config.includeAll ?? false,
          store.getCurrentNavigationId ?? undefined
        );
      },
    },
    {
      name: 'dom',
      telemetry: 'dom',
      async start({ cdp }) {
        return prepareDOMCollection(cdp);
      },
    },
  ];
}

export function shouldActivatePlugin(plugin: TelemetryPlugin, store: TelemetryStore): boolean {
  if (plugin.runAlways) {
    return true;
  }
  if (plugin.telemetry) {
    return store.activeTelemetry.includes(plugin.telemetry);
  }
  return false;
}
