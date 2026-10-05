/**
 * Identity of the Chrome bdg launched.
 *
 * chrome-launcher only waits until something answers on 127.0.0.1:<port>. That
 * may be another process: when 127.0.0.1:<port> is taken, Chrome listens on
 * [::1]:<port> instead and the readiness check is answered by the other one.
 *
 * Chrome prints `DevTools listening on ws://<host>:<port>/devtools/browser/<id>`
 * to stderr (chrome-launcher writes it to `chrome-err.log` in the profile).
 * The browser path is unique per browser, so comparing it with the one
 * 127.0.0.1:<port> reports tells whether that is the launched Chrome.
 * (Chrome's `DevToolsActivePort` file holds the same, but Chrome writes it only
 * for `--remote-debugging-port=0`.)
 *
 * A Chrome whose output lacks the line (stderr redirected, a Chromium build
 * that does not print it) is accepted with a warning when its browser answers
 * on 127.0.0.1 and nothing listens on [::1]: the port was free on both right
 * before the launch, and a second listener is how a conflict shows.
 */

import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { fetchBrowserWsUrl } from '@/utils/http.js';
import { isProcessAlive } from '@/utils/process.js';

import { ChromeLaunchError } from './errors.js';
import { acceptsConnections } from './portReservation.js';
import { readStartupLines, type StartupLogs } from './startupExit.js';

/** Chrome's stderr line announcing its debugging endpoint */
const LISTENING_PATTERN = /^DevTools listening on (ws:\/\/\S+)/;

/** How long to wait for Chrome to announce its endpoint after the port answered */
const ENDPOINT_WAIT_MS = 10000;

const ENDPOINT_POLL_MS = 50;

const log = createLogger('chrome');

/**
 * The debugging endpoint a Chrome announced for itself.
 */
export interface DevToolsEndpoint {
  /** Address the debugging server listens on (`127.0.0.1`, `[::1]`) */
  host: string;
  /** Port the debugging server listens on */
  port: number;
  /** Browser WebSocket path, `/devtools/browser/<id>` */
  browserPath: string;
}

/**
 * Find the endpoint Chrome announced in its output (the last announcement).
 *
 * @param lines - Chrome's output lines
 * @returns Endpoint, or null if there is no complete announcement
 */
export function parseDevToolsListening(lines: readonly string[]): DevToolsEndpoint | null {
  for (const line of [...lines].reverse()) {
    const match = LISTENING_PATTERN.exec(line.trim());
    if (!match?.[1]) continue;
    try {
      const url = new URL(match[1]);
      const port = Number(url.port);
      if (!port || !url.pathname.startsWith('/devtools/browser/')) continue;
      return { host: url.hostname, port, browserPath: url.pathname };
    } catch (error) {
      log.debug(`Ignoring malformed DevTools announcement: ${String(error)}`);
    }
  }
  return null;
}

/**
 * Wait for Chrome to announce its endpoint.
 *
 * @param logs - Chrome's log positions from before the launch
 * @param isRunning - Whether Chrome is still running (waiting stops when not)
 * @param timeoutMs - Longest wait
 * @returns Endpoint, or null if Chrome exited or announced none in time
 */
export async function waitForDevToolsEndpoint(
  logs: StartupLogs,
  isRunning: () => boolean,
  timeoutMs: number = ENDPOINT_WAIT_MS
): Promise<DevToolsEndpoint | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const endpoint = parseDevToolsListening(readStartupLines(logs));
    if (endpoint || !isRunning() || Date.now() >= deadline) return endpoint;
    await delay(ENDPOINT_POLL_MS);
  }
}

/**
 * Check that the Chrome answering on 127.0.0.1:<port> is the one just
 * launched, so bdg never drives another session's browser.
 *
 * @param options - Chrome's log positions from before the launch, requested
 *   port (free on 127.0.0.1 and ::1 right before the launch), Chrome's PID and
 *   longest wait for its announcement
 * @throws ChromeLaunchError: CHROME_DIED_AFTER_LAUNCH if Chrome exits first;
 *   PORT_IN_USE if another browser or process answers on the port;
 *   CHROME_LAUNCH_FAILED if Chrome announced nothing and nothing answers
 */
export async function verifyLaunchedChrome(options: {
  logs: StartupLogs;
  port: number;
  pid: number;
  timeoutMs?: number;
}): Promise<void> {
  const { logs, port, pid, timeoutMs } = options;
  const isRunning = (): boolean => isProcessAlive(pid);
  const endpoint = await waitForDevToolsEndpoint(logs, isRunning, timeoutMs);
  if (!endpoint && !isRunning()) {
    throw new ChromeLaunchError(`Chrome died immediately after launch (PID: ${pid})`, {
      issue: { code: 'CHROME_DIED_AFTER_LAUNCH', context: { port, pid } },
    });
  }
  if (!endpoint) return acceptUnannouncedChrome(logs, port);
  if (endpoint.port !== port) {
    throw portTakenError(port, `Chrome listens on port ${endpoint.port} instead`);
  }
  const answering = await fetchBrowserWsUrl(port, log);
  if (!answering || new URL(answering).pathname !== endpoint.browserPath) {
    throw portTakenError(
      port,
      `another process answers on 127.0.0.1 (Chrome listens on ${endpoint.host})`
    );
  }
  log.debug(`Chrome on port ${port} is the launched one (${endpoint.browserPath})`);
}

/**
 * Accept a Chrome that did not announce its endpoint, if a browser answers on
 * 127.0.0.1:<port> and nothing listens on [::1]:<port> (two listeners mean a
 * conflict).
 *
 * @param logs - Chrome's log positions (the stderr log is named in messages)
 * @param port - Requested port
 * @throws ChromeLaunchError: PORT_IN_USE for a second listener;
 *   CHROME_LAUNCH_FAILED if no browser answers
 */
async function acceptUnannouncedChrome(logs: StartupLogs, port: number): Promise<void> {
  const errLog = logs.files[0]?.file ?? 'chrome-err.log';
  const missing = `Chrome did not print "DevTools listening on" to ${errLog}`;
  if (!(await fetchBrowserWsUrl(port, log))) {
    throw new ChromeLaunchError(`${missing}, and no browser answers on port ${port}`, {
      issue: {
        code: 'CHROME_LAUNCH_FAILED',
        context: { port, reason: `${missing}, and no browser answers on port ${port}` },
      },
    });
  }
  if (await acceptsConnections(port, '::1')) {
    throw portTakenError(port, `${missing}, and both 127.0.0.1 and [::1] answer`);
  }
  log.info(
    `Warning: ${missing}; using the browser on 127.0.0.1:${port}, which was free before the launch`
  );
}

/**
 * The error for a port another process answers on.
 *
 * @param port - Requested port
 * @param reason - What was found
 * @returns Launch error with the PORT_IN_USE issue
 */
function portTakenError(port: number, reason: string): ChromeLaunchError {
  return new ChromeLaunchError(`Port ${port} is already in use: ${reason}`, {
    issue: { code: 'PORT_IN_USE', context: { port, reason } },
  });
}
