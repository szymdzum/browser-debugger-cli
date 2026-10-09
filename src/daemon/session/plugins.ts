import type { TelemetryStore } from './TelemetryStore.js';
import type { SessionConfig } from './types.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { startSessionDownloads } from '@/daemon/session/downloads.js';
import { hideHeadlessUserAgent } from '@/runtime/page/userAgent.js';
import { startConsoleCollection } from '@/telemetry/console.js';
import { startDialogHandling } from '@/telemetry/dialogs.js';
import { prepareDOMCollection } from '@/telemetry/dom.js';
import { startIssueCollection } from '@/telemetry/issues.js';
import { startNavigationTracking } from '@/telemetry/navigation.js';
import { startNetworkCollection, startWebSocketCollection } from '@/telemetry/network.js';
import { pageCrashedCommandError, startCrashTracking } from '@/telemetry/pageCrash.js';
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

/**
 * Make the page behave as focused even when its tab is in the background.
 *
 * Without this, once the page opens another tab (`window.open`, a
 * `target=_blank` link), every `Input.dispatchMouseEvent` waits about 5 s, and
 * fills before the first click fire no focus/blur events (the document never
 * had focus).
 *
 * @param cdp - CDP connection
 * @param logger - Logger for failures (the session works without it)
 */
async function emulatePageFocus(cdp: CDPConnection, logger: Logger): Promise<void> {
  await cdp
    .send('Emulation.setFocusEmulationEnabled', { enabled: true })
    .catch((error: unknown) => logger.debug(`No focus emulation: ${getErrorMessage(error)}`));
}

export interface TelemetryPlugin {
  name: string;
  runAlways?: boolean;
  telemetry?: TelemetryType;
  /**
   * `session`: started once for the whole session (it follows tab switches
   * itself, through `onPageSwitch`); others follow the session's tab, started
   * again on each tab `bdg page switch` moves to
   */
  scope?: 'session';
  start: (ctx: TelemetryPluginContext) => Promise<CleanupFunction>;
}

export interface TelemetryPluginContext {
  /** The session's page connection */
  cdp: CDPConnection;
  config: SessionConfig;
  store: TelemetryStore;
  logger: Logger;
  /** Registers a callback for the page connection of each tab the session moves to */
  onPageSwitch?: ((listener: (cdp: CDPConnection) => void) => void) | undefined;
  /** Started on a tab `bdg page switch` moved to (not the session's first) */
  switchedTab?: boolean | undefined;
}

export function createDefaultTelemetryPlugins(): TelemetryPlugin[] {
  return [
    {
      name: 'dialogs',
      runAlways: true,
      async start({ cdp, config, store }) {
        store.dialogAnswers.setSessionDefault(config.dialog);
        return startDialogHandling(cdp, store.dialogAnswers, (dialog) =>
          store.recordDialog(dialog)
        );
      },
    },
    {
      name: 'downloads',
      runAlways: true,
      scope: 'session',
      start: startSessionDownloads,
    },
    {
      name: 'page-identity',
      runAlways: true,
      async start({ cdp, logger, config }) {
        await emulatePageFocus(cdp, logger);
        if (!config.viewport?.mobile) await hideHeadlessUserAgent(cdp, logger);
        return () => undefined;
      },
    },
    {
      name: 'page-crash',
      runAlways: true,
      async start({ cdp, store }) {
        return startCrashTracking(cdp, (crashedAt) => {
          store.pageCrashedAt = crashedAt;
          if (crashedAt !== undefined) cdp.rejectPending(pageCrashedCommandError(crashedAt));
        });
      },
    },
    {
      name: 'navigation',
      runAlways: true,
      async start({ cdp, store, logger, switchedTab }) {
        const { cleanup, getCurrentNavigationId } = await startNavigationTracking(
          cdp,
          store.navigationEvents,
          switchedTab ? store.targetInfo?.url : undefined
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
          evictions: store.networkEvictions,
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
      async start({ cdp, config, store, switchedTab }) {
        return startConsoleCollection(
          cdp,
          store.consoleMessages,
          config.includeAll ?? false,
          store.getCurrentNavigationId ?? undefined,
          () => {
            store.consoleDropped++;
          },
          () => store.receiveConsoleMessage(),
          { skipReplay: switchedTab === true }
        );
      },
    },
    {
      name: 'issues',
      telemetry: 'console',
      start({ cdp, store, switchedTab }) {
        if (switchedTab) store.pageIssues.clear();
        return startIssueCollection(cdp, store.pageIssues);
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

/**
 * The registered plugins started once for the session, or the ones started
 * on each of its tabs.
 *
 * @param scope - `session` or `page`
 * @returns Plugins, in registration order
 */
export function telemetryPluginsOf(scope: 'session' | 'page'): TelemetryPlugin[] {
  return pluginRegistry.filter((plugin) => (plugin.scope === 'session') === (scope === 'session'));
}
