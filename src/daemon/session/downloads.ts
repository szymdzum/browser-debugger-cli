/**
 * Setting up a session's download tracking: where downloads go, and the
 * browser-level connection their events arrive on.
 */

import type { TelemetryPluginContext } from './plugins.js';
import type { SessionConfig } from './types.js';

import { CDPConnection } from '@/connection/cdp.js';
import { browserWebSocketUrl } from '@/daemon/session/chromeConnection.js';
import { ensureSessionDownloadsDir } from '@/session/paths.js';
import { startDownloadTracking, type DownloadDestination } from '@/telemetry/downloads.js';
import type { CleanupFunction } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { downloadsDirUnavailableReason } from '@/ui/messages/commands.js';
import { getErrorMessage } from '@/utils/errors.js';

/** Connection attempts for the browser-level connection (Chrome is already running) */
const BROWSER_CONNECT_ATTEMPTS = 2;

/**
 * Track the session's downloads (see {@link startDownloadTracking}) on a
 * browser-level connection, so downloads of tabs the page opens are named
 * and recorded too; on the page's connection when Chrome offers no
 * browser-level one.
 *
 * @param context - Plugin context
 * @returns Cleanup: stops tracking and closes the browser-level connection
 */
export async function startSessionDownloads(
  context: TelemetryPluginContext
): Promise<CleanupFunction> {
  const { cdp, config, store, logger } = context;
  const browser = await connectBrowser(config, logger);
  const stop = await startDownloadTracking(
    browser ?? cdp,
    store.downloads,
    downloadDestination(config, logger)
  );
  return async () => {
    await stop();
    browser?.close();
  };
}

/**
 * Open a browser-level connection to the session's Chrome.
 *
 * @param config - Session configuration
 * @param logger - Logger
 * @returns Open connection, or null when there is none to open
 */
async function connectBrowser(
  config: SessionConfig,
  logger: Logger
): Promise<CDPConnection | null> {
  const url = await browserWebSocketUrl(config, logger);
  if (!url) return null;
  const browser = new CDPConnection(logger);
  try {
    await browser.connect(url, { maxRetries: BROWSER_CONNECT_ATTEMPTS });
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
