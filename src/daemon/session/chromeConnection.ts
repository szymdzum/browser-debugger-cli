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
import {
  chromeInUseBySessionError,
  externalBrowserIdMismatchError,
  externalChromeUnreachableError,
  externalPageNotFoundError,
  notDevToolsEndpointError,
} from '@/errors/messages.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import { writeChromePid } from '@/session/chrome.js';
import { findConflictingOwner } from '@/session/chromeOwners.js';
import { getSessionDir } from '@/session/paths.js';
import type { CDPTarget, LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  createPageTarget,
  fetchBrowserWsUrl,
  fetchCDPTargets,
  probeDevToolsEndpoint,
} from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Setup Chrome connection - either launch new instance or connect to existing.
 *
 * @param config - Session configuration
 * @param telemetryStore - Store receiving the target info
 * @param log - Logger
 * @param notify - Receives notices about an external Chrome
 * @param signal - Ends a launch at once when aborted (the session was stopped)
 * @returns Launched Chrome instance (null if connecting to external Chrome)
 */
export async function setupChromeConnection(
  config: SessionConfig,
  telemetryStore: TelemetryStore,
  log: Logger,
  notify: NoticeSink<ChromeNoticeCode>,
  signal?: AbortSignal
): Promise<LaunchedChrome | null> {
  if (config.chromeWsUrl) {
    return setupExternalChrome(config, telemetryStore, log, notify);
  } else {
    return setupLaunchedChrome(config, log, signal);
  }
}

/** Path of browser-level DevTools WebSocket URLs (`/devtools/browser/<uuid>`) */
const BROWSER_WS_PATH = '/devtools/browser/';

/**
 * Browser-level DevTools WebSocket URL of the session's Chrome: a launched
 * Chrome's, or for `--chrome-ws-url` the URL itself when it is browser-level,
 * else the one Chrome reports, reached the way the user's URL is.
 *
 * @param config - Session configuration (port resolved)
 * @param log - Logger
 * @returns The URL, or null when Chrome does not answer `/json/version`
 */
export async function browserWebSocketUrl(
  config: SessionConfig,
  log: Logger
): Promise<string | null> {
  if (!config.chromeWsUrl) return fetchBrowserWsUrl(config.port, log);
  const { hostname, pathname, protocol, port } = new URL(config.chromeWsUrl);
  if (pathname.startsWith(BROWSER_WS_PATH)) return config.chromeWsUrl;
  const http = { host: hostname, secure: protocol === 'wss:' };
  const reported = await fetchBrowserWsUrl(config.port, log, http);
  return reported && withEndpoint(reported, protocol, hostname, port);
}

/**
 * DevTools WebSocket URL of another tab, reached the way the session's page
 * is (same scheme, host, port, path prefix and query: an attached Chrome
 * behind a proxy too), with the page id as the last path segment.
 *
 * @param pageWsUrl - WebSocket URL of the session's page
 * @param targetId - Target id of the other tab
 * @returns `…/devtools/page/<targetId>`
 */
export function tabWebSocketUrl(pageWsUrl: string, targetId: string): string {
  const url = new URL(pageWsUrl);
  url.pathname = url.pathname.replace(/[^/]*$/, encodeURIComponent(targetId));
  return url.toString();
}

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
  const { hostname, pathname, protocol, port } = new URL(wsUrl);
  const http = { host: hostname, secure: protocol === 'wss:' };
  const endpoint = `${http.secure ? 'https' : 'http'}://${hostname}:${config.port}`;
  const probe = await probeDevToolsEndpoint(config.port, log, http);
  if (probe.kind !== 'devtools') {
    const err =
      probe.kind === 'not-devtools'
        ? notDevToolsEndpointError(endpoint)
        : externalChromeUnreachableError(endpoint, http.secure);
    fail(err, EXIT_CODES.CDP_CONNECTION_FAILURE);
  }
  const browserWsUrl = probe.wsUrl;
  const targets = await fetchCDPTargets(config.port, log, http);
  const targetId = pathname.split('/').pop() ?? '';
  if (!pathname.startsWith(BROWSER_WS_PATH)) {
    const known = targets.find((t) => t.id === targetId);
    if (!known) fail(externalPageNotFoundError(targetId, endpoint), EXIT_CODES.RESOURCE_NOT_FOUND);
    await assertNotOwned(targets, known.id, endpoint);
    return { ...known, webSocketDebuggerUrl: wsUrl };
  }
  if (new URL(browserWsUrl).pathname !== pathname) {
    const actual = withEndpoint(browserWsUrl, protocol, hostname, port);
    fail(externalBrowserIdMismatchError(endpoint, actual), EXIT_CODES.RESOURCE_NOT_FOUND);
  }

  const firstPage = targets.find((t) => t.type === 'page');
  await assertNotOwned(targets, firstPage?.id ?? '', endpoint);
  const page = firstPage ?? (await createPageTarget(hostname, config.port, log, http));
  if (!page)
    fail(externalChromeUnreachableError(endpoint, http.secure), EXIT_CODES.CDP_CONNECTION_FAILURE);
  log.info(`Attaching to page ${page.url} of the external Chrome`);
  return {
    ...page,
    webSocketDebuggerUrl: withEndpoint(page.webSocketDebuggerUrl, protocol, hostname, port),
  };
}

/**
 * Refuse to attach when another running bdg session launched this Chrome or
 * drives the tab this session would use: taking it over would mix both
 * sessions' telemetry and let one end the other.
 *
 * @param targets - Every target of the Chrome
 * @param targetId - Tab this session would drive ('' for a tab still to be opened)
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @throws CommandError (90) naming the other session
 */
async function assertNotOwned(
  targets: CDPTarget[],
  targetId: string,
  endpoint: string
): Promise<void> {
  const owner = await findConflictingOwner(
    targets.map((t) => t.id),
    targetId
  );
  if (owner) fail(chromeInUseBySessionError(endpoint, owner), EXIT_CODES.RESOURCE_CONFLICT);
}

/**
 * A DevTools WebSocket URL from Chrome, reached the way the user's URL is
 * (Chrome reports its own host, e.g. 127.0.0.1, even behind a proxy).
 *
 * @param url - URL reported by Chrome
 * @param protocol - Protocol of the user's URL
 * @param hostname - Host of the user's URL
 * @param port - Port of the user's URL
 * @returns The URL with the user's protocol, host and port
 */
function withEndpoint(url: string, protocol: string, hostname: string, port: string): string {
  const result = new URL(url);
  result.protocol = protocol;
  result.hostname = hostname;
  result.port = port;
  return result.toString();
}

/**
 * Throw a user-facing error.
 *
 * @param err - Message and suggestion
 * @param exitCode - Exit code
 * @throws CommandError always
 */
function fail(err: { message: string; suggestion: string }, exitCode: number): never {
  throw new CommandError(err.message, { suggestion: err.suggestion }, exitCode);
}

/**
 * Chrome flags of a launched Chrome: with `--viewport`, a window of that size
 * first (so tabs the page opens get it too), then the user's own flags, which
 * win over it.
 *
 * @param config - Session configuration
 * @returns Flags, or undefined without any
 */
export function windowSizeFlags(config: SessionConfig): string[] | undefined {
  if (!config.viewport) return config.chromeFlags;
  const { width, height } = config.viewport;
  return [`--window-size=${width},${height}`, ...(config.chromeFlags ?? [])];
}

/**
 * Launch a new Chrome instance and record its PID for crash cleanup.
 *
 * @param config - Session configuration
 * @param log - Logger
 * @param signal - Ends the launch at once when aborted
 * @returns Launched Chrome
 */
async function setupLaunchedChrome(
  config: SessionConfig,
  log: Logger,
  signal: AbortSignal | undefined
): Promise<LaunchedChrome> {
  const chrome = await launchChrome({
    port: config.port,
    logger: log,
    sessionDir: getSessionDir(),
    signal,
    ...filterDefined({
      userDataDir: config.userDataDir,
      headless: config.headless,
      chromeFlags: windowSizeFlags(config),
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
