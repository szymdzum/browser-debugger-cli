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
 * @param context - Plugin context
 * @param connectBrowser - Opens the browser-level connection
 * @returns Cleanup: stops tracking and closes the browser-level connection
 */
export async function startSessionDownloads(
  context: TelemetryPluginContext,
  connectBrowser: BrowserConnector = openBrowserConnection
): Promise<CleanupFunction> {
  const { config, store, logger } = context;
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
