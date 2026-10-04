import type { TelemetryStore } from './TelemetryStore.js';
import type { SessionConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { startConsoleCollection } from '@/telemetry/console.js';
import { startDialogHandling } from '@/telemetry/dialogs.js';
import { prepareDOMCollection } from '@/telemetry/dom.js';
import { startNavigationTracking } from '@/telemetry/navigation.js';
import { startNetworkCollection, startWebSocketCollection } from '@/telemetry/network.js';
import type { CleanupFunction, TelemetryType } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { filterDefined } from '@/utils/objects.js';

/** Delay before reading the title after a same-document navigation */
const TITLE_REFRESH_DELAY_MS = 300;

/**
 * Keep the store's target URL and title in sync with the page.
 *
 * The target info is captured once at session start; without this, `status`,
 * `peek` and "session already running" keep reporting the start URL after the
 * page navigates. Same-document navigations (`history.pushState`, hash
 * changes in single-page apps) update the URL too, and the title shortly
 * after (apps set it once the new view renders).
 *
 * @param cdp - CDP connection
 * @param store - Telemetry store whose target info is updated
 * @param logger - Logger for title refresh failures
 * @returns Cleanup function
 */
function trackCurrentPage(cdp: CDPConnection, store: TelemetryStore, logger: Logger): () => void {
  const update = (fields: { url?: string; title?: string }): void => {
    if (store.targetInfo) store.setTargetInfo({ ...store.targetInfo, ...fields });
  };
  const refreshTitle = (): void => {
    cdp
      .send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
      .then((response) => {
        const value = (response as { result?: { value?: unknown } }).result?.value;
        if (typeof value === 'string') update({ title: value });
      })
      .catch((error: unknown) => {
        logger.debug(`Could not refresh page title: ${getErrorMessage(error)}`);
      });
  };
  let mainFrameId: string | undefined;
  let titleTimer: NodeJS.Timeout | undefined;
  cdp
    .send('Page.getFrameTree')
    .then((tree) => {
      mainFrameId ??= (tree as { frameTree?: { frame?: { id?: string } } }).frameTree?.frame?.id;
    })
    .catch((error: unknown) => logger.debug(`No frame tree: ${getErrorMessage(error)}`));
  const cleanups = [
    cdp.on<{ frame: { id: string; parentId?: string; url: string } }>(
      'Page.frameNavigated',
      ({ frame }) => {
        if (frame.parentId !== undefined) return;
        mainFrameId = frame.id;
        update({ url: frame.url, title: '' });
      }
    ),
    cdp.on<{ frameId: string; url: string }>('Page.navigatedWithinDocument', (params) => {
      if (params.frameId !== mainFrameId) return;
      update({ url: params.url });
      clearTimeout(titleTimer);
      titleTimer = setTimeout(refreshTitle, TITLE_REFRESH_DELAY_MS);
    }),
    cdp.on('Page.loadEventFired', refreshTitle),
  ];
  return () => {
    clearTimeout(titleTimer);
    cleanups.forEach((cleanup) => cleanup());
  };
}

export interface TelemetryPlugin {
  name: string;
  runAlways?: boolean;
  telemetry?: TelemetryType;
  start: (ctx: TelemetryPluginContext) => Promise<CleanupFunction>;
}

export interface TelemetryPluginContext {
  cdp: CDPConnection;
  config: SessionConfig;
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
      async start({ cdp, store, logger }) {
        const { cleanup, getCurrentNavigationId } = await startNavigationTracking(
          cdp,
          store.navigationEvents
        );
        store.setNavigationResolver(getCurrentNavigationId);
        const stopTracking = trackCurrentPage(cdp, store, logger);
        return () => {
          stopTracking();
          void cleanup();
        };
      },
    },
    {
      name: 'network',
      telemetry: 'network',
      async start({ cdp, config, store }) {
        const networkOptions = {
          includeAll: config.includeAll ?? false,
          fetchAllBodies: config.includeAll ?? false,
          getCurrentNavigationId: store.getCurrentNavigationId ?? undefined,
          pendingRequests: store.pendingNetworkRequests,
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
