import type { TelemetryStore } from './TelemetryStore.js';
import type { WorkerConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { startConsoleCollection } from '@/telemetry/console.js';
import { startDialogHandling } from '@/telemetry/dialogs.js';
import { prepareDOMCollection } from '@/telemetry/dom.js';
import { startNavigationTracking } from '@/telemetry/navigation.js';
import { startNetworkCollection, startWebSocketCollection } from '@/telemetry/network.js';
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

const TITLE_REFRESH_DELAYS_MS = [100, 500, 1500];

/**
 * Refresh the stored page title after a main-frame navigation.
 *
 * Best-effort: if the CDP call fails or the document is still loading when
 * we query, silently give up rather than surfacing the error to the user.
 */
async function refreshTitle(cdp: CDPConnection, store: TelemetryStore): Promise<void> {
  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    });
    const result = (response as { result?: { value?: unknown } }).result;
    const documentTitle = typeof result?.value === 'string' ? result.value.trim() : '';
    const prev = store.targetInfo;
    if (!prev) return;
    const title = documentTitle || deriveTitleFromUrl(prev.url);
    if (!title || title === prev.title) return;
    store.setTargetInfo({ ...prev, title });
  } catch {
    // Swallow: losing the title refresh is preferable to crashing the worker.
  }
}

/**
 * Fallback title for pages without a `<title>` tag. Mirrors what Chrome puts
 * in its targets listing (`/json`) so the status output stays consistent
 * with what the initial navigation produced.
 */
function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

/**
 * Schedule a few retries of `refreshTitle` at increasing delays so we don't
 * depend on Page.loadEventFired alone — some in-page navigations that update
 * the title don't trigger a new load event.
 */
function scheduleTitleRefresh(cdp: CDPConnection, store: TelemetryStore): void {
  const targetAtScheduleTime = store.targetInfo;
  for (const delayMs of TITLE_REFRESH_DELAYS_MS) {
    setTimeout(() => {
      const current = store.targetInfo;
      // Only refresh if the URL matches what we saw when scheduling; a new
      // nav has already set up its own retries by then.
      if (!current || current.url !== targetAtScheduleTime?.url) return;
      if (current.title) return;
      void refreshTitle(cdp, store);
    }, delayMs).unref();
  }
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
          store.navigationEvents,
          (url) => {
            const prev = store.targetInfo;
            if (!prev) return;
            store.setTargetInfo({ ...prev, url, title: '' });
            scheduleTitleRefresh(cdp, store);
          },
          () => {
            void refreshTitle(cdp, store);
          }
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
      name: 'websocket',
      telemetry: 'network',
      start({ cdp, store }) {
        return Promise.resolve(startWebSocketCollection(cdp, store.websocketConnections));
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
        return await prepareDOMCollection(cdp);
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

const pluginRegistry: TelemetryPlugin[] = createDefaultTelemetryPlugins();

export function getRegisteredTelemetryPlugins(): TelemetryPlugin[] {
  return [...pluginRegistry];
}
