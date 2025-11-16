import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type { CommandName, CommandSchemas, WorkerStatusData } from '@/ipc/index.js';
import { filterDefined } from '@/utils/objects.js';
import { VERSION } from '@/utils/version.js';

type Handler<K extends CommandName> = (
  cdp: CDPConnection,
  params: CommandSchemas[K]['requestSchema']
) => Promise<CommandSchemas[K]['responseSchema']>;

export type CommandRegistry = {
  [K in CommandName]: Handler<K>;
};

export function createCommandRegistry(store: TelemetryStore): CommandRegistry {
  return {
    worker_peek: async (_cdp, params) => {
      const lastN = Math.min(params.lastN ?? 10, 100);
      const offset = params.offset ?? 0;
      const duration = Date.now() - store.sessionStartTime;

      // Calculate slice positions from the end, accounting for offset
      const totalNetwork = store.networkRequests.length;
      const totalConsole = store.consoleMessages.length;

      const networkStart = Math.max(0, totalNetwork - lastN - offset);
      const networkEnd = Math.max(0, totalNetwork - offset);
      const consoleStart = Math.max(0, totalConsole - lastN - offset);
      const consoleEnd = Math.max(0, totalConsole - offset);

      const recentNetwork = store.networkRequests.slice(networkStart, networkEnd).map((req) =>
        filterDefined({
          requestId: req.requestId,
          timestamp: req.timestamp,
          method: req.method,
          url: req.url,
          status: req.status,
          mimeType: req.mimeType,
        })
      );

      const recentConsole = store.consoleMessages.slice(consoleStart, consoleEnd).map((msg) => ({
        timestamp: msg.timestamp,
        type: msg.type,
        text: msg.text,
      }));

      return Promise.resolve({
        version: VERSION,
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        network: recentNetwork,
        console: recentConsole,
        totalNetwork,
        totalConsole,
        hasMoreNetwork: networkStart > 0,
        hasMoreConsole: consoleStart > 0,
      });
    },

    worker_details: async (_cdp, params) => {
      if (params.itemType === 'network') {
        const request = store.networkRequests.find((r) => r.requestId === params.id);
        if (!request) {
          return Promise.reject(new Error(`Network request not found: ${params.id}`));
        }

        return Promise.resolve({ item: request });
      } else if (params.itemType === 'console') {
        const index = parseInt(params.id, 10);
        if (isNaN(index) || index < 0 || index >= store.consoleMessages.length) {
          return Promise.reject(
            new Error(
              `Console message not found at index: ${params.id} (available: 0-${store.consoleMessages.length - 1})`
            )
          );
        }

        const message = store.consoleMessages[index];
        if (!message) {
          return Promise.reject(new Error(`Console message not found at index: ${params.id}`));
        }

        return Promise.resolve({ item: message });
      }
      return Promise.reject(
        new Error(`Unknown itemType: ${String(params.itemType)}. Expected 'network' or 'console'.`)
      );
    },

    worker_status: async (_cdp, _params) => {
      const duration = Date.now() - store.sessionStartTime;

      const lastNetworkRequest = store.networkRequests[store.networkRequests.length - 1];
      const lastConsoleMessage = store.consoleMessages[store.consoleMessages.length - 1];

      const result: WorkerStatusData = {
        startTime: store.sessionStartTime,
        duration,
        target: {
          url: store.targetInfo?.url ?? '',
          title: store.targetInfo?.title ?? '',
        },
        activeTelemetry: store.activeTelemetry,
        activity: filterDefined({
          networkRequestsCaptured: store.networkRequests.length,
          consoleMessagesCaptured: store.consoleMessages.length,
          lastNetworkRequestAt: lastNetworkRequest?.timestamp,
          lastConsoleMessageAt: lastConsoleMessage?.timestamp,
        }) as {
          networkRequestsCaptured: number;
          consoleMessagesCaptured: number;
          lastNetworkRequestAt?: number;
          lastConsoleMessageAt?: number;
        },
      };

      return Promise.resolve(result);
    },

    cdp_call: async (cdp, params) => {
      const result = await cdp.send(params.method, params.params ?? {});
      return { result };
    },
  } as CommandRegistry;
}
