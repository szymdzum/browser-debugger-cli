/**
 * Setting up a session's download tracking: where downloads go, and the
 * connection their events arrive on.
 */

import type { TelemetryPluginContext } from './plugins.js';
import type { SessionConfig } from './types.js';

import { CDPConnection } from '@/connection/cdp.js';
import { browserWebSocketUrl } from '@/daemon/session/chromeConnection.js';
import { ensureSessionDownloadsDir } from '@/session/paths.js';
import { DownloadTracker, type DownloadDestination } from '@/telemetry/downloads.js';
import type { CleanupFunction } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { downloadsDirUnavailableReason } from '@/ui/messages/commands.js';
import { getErrorMessage } from '@/utils/errors.js';

/** Connection attempts for the browser-level connection (Chrome is already running) */
const BROWSER_CONNECT_ATTEMPTS = 2;

/**
 * Opens a browser-level connection to the session's Chrome, or null when
 * there is none; `onLost` is called if it closes while the session runs.
 */
export type BrowserConnector = (
  config: SessionConfig,
  logger: Logger,
  onLost: () => void
) => Promise<CDPConnection | null>;

/**
 * Track the session's downloads (see {@link DownloadTracker}).
 *
 * For a Chrome bdg launched, on a browser-level connection, so downloads of
 * tabs the page opens are named and recorded too; on the page's connection
 * when there is none, or once it is lost (Chrome drops a connection's
 * download behavior with it, so it is applied again there). An attached
 * Chrome (`--chrome-ws-url`) is followed on the page's connection only: a
 * browser-level one would count the user's other tabs' downloads as the
 * session's, and a Chrome that allows one connection (toggle mode) would
 * ask again for each. Following the page's connection, tracking moves with
 * the session to each tab `bdg page switch` makes the session's.
 *
 * A tab attached with `bdg attach` is followed by {@link followAttachedTab}.
 *
 * @param context - Plugin context
 * @param connectBrowser - Opens the browser-level connection
 * @returns Cleanup: stops tracking and closes the browser-level connection
 */
export async function startSessionDownloads(
  context: TelemetryPluginContext,
  connectBrowser: BrowserConnector = openBrowserConnection
): Promise<CleanupFunction> {
  const { config, store, logger } = context;
  if (config.attachTab !== undefined) return followAttachedTab(context);
  const tracker = new DownloadTracker(store, downloadDestination(config, logger));
  let page = context.cdp;
  let onPage = false;
  const browser = config.chromeWsUrl
    ? null
    : await connectBrowser(config, logger, () => {
        onPage = true;
        void followOnPage(tracker, page, logger);
      });
  if (!browser) onPage = true;
  context.onPageSwitch?.((next) => {
    page = next;
    if (onPage) void tracker.attach(next);
  });
  await tracker.attach(browser ?? page);
  return () => {
    tracker.stop();
    browser?.close();
  };
}

/** Download behavior that changes nothing: Chrome saves where the user's settings say */
const USER_BEHAVIOR = { behavior: 'default' };

/**
 * Follow the downloads of a tab attached with `bdg attach`, on the session's
 * one connection, without changing where the user's browser saves them:
 * `behavior: 'default'` with events on, set for the browser (events of an
 * out-of-process iframe reach no page session; they cover the whole
 * browser, so only downloads of the tab's frames are recorded), and events
 * off again when the session ends. Events without a frame id are dropped.
 *
 * @param context - Plugin context
 * @returns Cleanup: stops tracking and turns the events off
 */
export async function followAttachedTab(context: TelemetryPluginContext): Promise<CleanupFunction> {
  const { cdp, store, logger } = context;
  const frames = await tabFrames(cdp, store.targetInfo?.id ?? '', logger);
  const tracker = new DownloadTracker(store, { kind: 'browser' }, (frameId) =>
    frames.has(frameId ?? '')
  );
  await tracker.attach(browserLevel(cdp));
  return async () => {
    tracker.stop();
    frames.stop();
    await cdp
      .sendToBrowser('Browser.setDownloadBehavior', { ...USER_BEHAVIOR, eventsEnabled: false })
      .catch((error: unknown) =>
        logger.debug(`Download events not turned off: ${getErrorMessage(error)}`)
      );
  };
}

/**
 * The connection with its commands sent to the browser itself: download
 * events of out-of-process iframes reach only a browser-level session, and
 * the events are filtered by frame anyway.
 *
 * @param cdp - Connection with a default page session
 * @returns The same connection, commands past the page session
 */
function browserLevel(cdp: CDPConnection): CDPConnection {
  return Object.assign(Object.create(cdp) as CDPConnection, {
    send: (method: string, params?: Record<string, unknown>) => cdp.sendToBrowser(method, params),
  });
}

/**
 * Frame ids of a tab: its main frame (the target id), the frames in its tree
 * now, and frames attached later, out-of-process iframes included (their
 * frame id is their target id, announced when auto-attach attaches them;
 * frames inside them come as `Page.frameAttached` of their session).
 *
 * @param cdp - The tab's connection
 * @param targetId - The tab
 * @param logger - Logger
 * @returns The ids, and `stop` to stop following new frames
 */
async function tabFrames(
  cdp: CDPConnection,
  targetId: string,
  logger: Logger
): Promise<Set<string> & { stop: () => void }> {
  const ids = new Set<string>([targetId]);
  const stops = [
    cdp.on<{ frameId: string }>('Page.frameAttached', ({ frameId }) => ids.add(frameId)),
    cdp.on<{ targetInfo: { targetId: string; type: string } }>(
      'Target.attachedToTarget',
      ({ targetInfo }) => {
        if (targetInfo.type === 'iframe') ids.add(targetInfo.targetId);
      }
    ),
  ];
  const stop = (): void => stops.forEach((remove) => remove());
  try {
    const { frameTree } = (await cdp.send('Page.getFrameTree')) as { frameTree: FrameTreeNode };
    collectFrameIds(frameTree, ids);
  } catch (error) {
    logger.debug(`Frame tree not read: ${getErrorMessage(error)}`);
  }
  return Object.assign(ids, { stop });
}

/** `Page.getFrameTree` node (the fields read) */
interface FrameTreeNode {
  frame: { id: string };
  childFrames?: FrameTreeNode[];
}

/**
 * Add the ids of a frame tree to a set.
 *
 * @param node - Tree node
 * @param ids - Receives the ids
 */
function collectFrameIds(node: FrameTreeNode, ids: Set<string>): void {
  ids.add(node.frame.id);
  node.childFrames?.forEach((child) => collectFrameIds(child, ids));
}

/**
 * Follow downloads on the page's connection after the browser-level one was lost.
 *
 * @param tracker - Session download tracker
 * @param cdp - Connection of the session's tab
 * @param logger - Logger
 */
async function followOnPage(
  tracker: DownloadTracker,
  cdp: CDPConnection,
  logger: Logger
): Promise<void> {
  logger.info('Browser connection for downloads lost; download behavior set again on the page');
  await tracker.attach(cdp);
}

/**
 * Open a browser-level connection to the session's Chrome.
 *
 * @param config - Session configuration
 * @param logger - Logger
 * @param onLost - Called if the connection closes while the session runs
 * @returns Open connection, or null when there is none to open
 */
async function openBrowserConnection(
  config: SessionConfig,
  logger: Logger,
  onLost: () => void
): Promise<CDPConnection | null> {
  const url = await browserWebSocketUrl(config, logger);
  if (!url) return null;
  const browser = new CDPConnection(logger);
  try {
    await browser.connect(url, { maxRetries: BROWSER_CONNECT_ATTEMPTS, onDisconnect: onLost });
    return browser;
  } catch (error) {
    logger.debug(`No browser-level connection for downloads: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Where the session's downloads go: the session's `downloads/` for a Chrome
 * bdg launched (refused when it cannot be created, rather than saved to the
 * browser's default `~/Downloads`), the browser's own place for an attached
 * Chrome.
 *
 * @param config - Session configuration
 * @param logger - Logger
 * @returns Destination
 */
function downloadDestination(config: SessionConfig, logger: Logger): DownloadDestination {
  if (config.chromeWsUrl) return { kind: 'browser' };
  try {
    return { kind: 'directory', dir: ensureSessionDownloadsDir() };
  } catch (error) {
    const reason = downloadsDirUnavailableReason(getErrorMessage(error));
    logger.info(reason);
    return { kind: 'refused', reason };
  }
}
