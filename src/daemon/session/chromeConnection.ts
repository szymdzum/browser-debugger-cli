/**
 * Chrome Connection Setup
 *
 * Handles Chrome launch or connection to existing Chrome instance.
 * Finds the appropriate CDP target for the session.
 */

import { ChromeLaunchError } from '@/connection/errors.js';
import { launchChrome } from '@/connection/launcher.js';
import { HTTP_LOCALHOST } from '@/constants.js';
import { ConfigError } from '@/daemon/errors.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { CommandError } from '@/errors/index.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import { writeChromePid } from '@/session/chrome.js';
import { getSessionDir } from '@/session/paths.js';
import type { CDPTarget, LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { createPageTarget, fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Setup Chrome connection - either launch new instance or connect to existing.
 *
 * @returns Launched Chrome instance (null if connecting to external Chrome)
 */
export async function setupChromeConnection(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  log: Logger,
  notify: NoticeSink<ChromeNoticeCode>
): Promise<LaunchedChrome | null> {
  if (config.chromeWsUrl) {
    return setupExternalChrome(config, telemetryStore, log, notify);
  } else {
    return setupLaunchedChrome(config, log);
  }
}

/** Path of browser-level DevTools WebSocket URLs (`/devtools/browser/<uuid>`) */
const BROWSER_WS_PATH = '/devtools/browser/';

/**
 * Debugging port of an external Chrome, taken from its WebSocket URL.
 *
 * @param wsUrl - `--chrome-ws-url` value
 * @returns Port in the URL, or the protocol default
 */
export function externalChromePort(wsUrl: string): number {
  const url = new URL(wsUrl);
  return Number(url.port) || (url.protocol === 'wss:' ? 443 : 80);
}

/**
 * Connect to existing external Chrome instance.
 */
async function setupExternalChrome(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  log: Logger,
  notify: NoticeSink<ChromeNoticeCode>
): Promise<null> {
  const wsUrl = config.chromeWsUrl;
  if (!wsUrl) {
    throw new ConfigError(
      'chromeWsUrl is required for external Chrome connection',
      'MISSING_WS_URL'
    );
  }

  notify({ code: 'EXTERNAL_CHROME_CONNECTING' });
  notify({ code: 'EXTERNAL_CHROME_WS_URL', context: { wsUrl } });
  telemetryStore.setTargetInfo(await resolveExternalTarget(wsUrl, config, log));
  notify({ code: 'EXTERNAL_CHROME_NO_PID' });

  return null;
}

/**
 * Find the page to attach to in an external Chrome.
 *
 * A page URL is used as given. A browser-level URL cannot run page commands,
 * so the first open page is used (a blank one is opened if there is none),
 * reached through the same scheme, host and port (HTTPS for a `wss:` URL).
 *
 * @param wsUrl - `--chrome-ws-url` value
 * @param config - Session configuration (port is the URL's port)
 * @param log - Logger
 * @returns Page target
 * @throws CommandError if no page can be found or opened
 */
async function resolveExternalTarget(
  wsUrl: string,
  config: SessionConfig,
  log: Logger
): Promise<CDPTarget> {
  const { hostname, host, pathname, protocol, port } = new URL(wsUrl);
  const http = { host: hostname, secure: protocol === 'wss:' };
  const targets = await fetchCDPTargets(config.port, log, http);
  const targetId = pathname.split('/').pop() ?? 'external';
  if (!pathname.startsWith(BROWSER_WS_PATH)) {
    const known = targets.find((t) => t.id === targetId);
    return {
      ...(known ?? { id: targetId, type: 'page', title: '', url: config.url }),
      webSocketDebuggerUrl: wsUrl,
    };
  }

  const page =
    targets.find((t) => t.type === 'page') ??
    (await createPageTarget(hostname, config.port, log, http));
  if (!page) {
    throw new CommandError(
      `No page to attach to in the Chrome at ${host}`,
      {
        suggestion: `Check that Chrome is running with --remote-debugging-port=${config.port} and reachable`,
      },
      EXIT_CODES.CDP_CONNECTION_FAILURE
    );
  }
  const pageWsUrl = new URL(page.webSocketDebuggerUrl);
  pageWsUrl.protocol = protocol;
  pageWsUrl.hostname = hostname;
  pageWsUrl.port = port;
  log.info(`Attaching to page ${page.url} of the external Chrome`);
  return { ...page, webSocketDebuggerUrl: pageWsUrl.toString() };
}

/**
 * Launch a new Chrome instance and record its PID for crash cleanup.
 */
async function setupLaunchedChrome(config: SessionConfig, log: Logger): Promise<LaunchedChrome> {
  const chrome = await launchChrome({
    port: config.port,
    logger: log,
    sessionDir: getSessionDir(),
    ...filterDefined({
      userDataDir: config.userDataDir,
      headless: config.headless,
      chromeFlags: config.chromeFlags,
    }),
  });

  log.info(`Chrome launched (PID ${chrome.pid})`);

  writeChromePid(chrome.pid);
  log.debug(`Chrome PID ${chrome.pid} cached for emergency cleanup`);

  return chrome;
}

/**
 * Find the page target of a Chrome that bdg launched.
 *
 * Kept separate from the launch so the session owns Chrome before this can
 * fail, and tears it down if it does. A Chrome that has not opened its first
 * tab yet gets a blank one.
 *
 * @param config - Session configuration
 * @param telemetryStore - Store receiving the target info
 * @param log - Logger
 * @throws ChromeLaunchError if Chrome exposes no page target
 */
export async function findPageTarget(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  log: Logger
): Promise<void> {
  log.info(`Connecting to Chrome via CDP...`);
  const targets = await fetchCDPTargets(config.port, log);
  const foundTarget =
    targets.find((t) => t.type === 'page') ??
    (await createPageTarget(HTTP_LOCALHOST, config.port, log));

  if (!foundTarget) {
    const availableTargets = targets.length
      ? targets
          .map(
            (t, i) =>
              `  ${i + 1}. ${t.title || '(no title)'}\n     URL: ${t.url}\n     Type: ${t.type}`
          )
          .join('\n')
      : null;

    throw new ChromeLaunchError('No page target found after Chrome launch', {
      issue: {
        code: 'NO_PAGE_TARGET_FOUND',
        context: { port: config.port, availableTargets },
      },
    });
  }

  telemetryStore.setTargetInfo(foundTarget);
  log.info(`Found target: ${foundTarget.title} (${foundTarget.url})`);
}
