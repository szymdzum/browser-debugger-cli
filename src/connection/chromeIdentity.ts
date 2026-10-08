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
import {
  CHROME_LAUNCH_ABORTED_MESSAGE,
  chromeNotAnsweringReason,
  portTakenByReason,
} from '@/ui/messages/chrome.js';
import { delay } from '@/utils/async.js';
import {
  CDP_HTTP_TIMEOUT_MS,
  fetchBrowserWsUrl,
  probeDevToolsEndpoint,
  type DevToolsProbe,
} from '@/utils/http.js';
import { isProcessAlive } from '@/utils/process.js';

import { ChromeLaunchError } from './errors.js';
import { acceptsConnections } from './portReservation.js';
import { readStartupLines, type StartupLogs } from './startupExit.js';

/** Chrome's stderr line announcing its debugging endpoint */
const LISTENING_PATTERN = /^DevTools listening on (ws:\/\/\S+)/;

/** How long to wait for Chrome to announce its endpoint after the port answered */
const ENDPOINT_WAIT_MS = 10000;

const ENDPOINT_POLL_MS = 50;

/** Shortest wait for one answer, also when the deadline has passed */
const MIN_ANSWER_WAIT_MS = 1000;

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
 * @param signal - Ends the wait early when aborted
 * @returns Endpoint, or null if Chrome exited, announced none in time or the
 *   wait was aborted
 */
export async function waitForDevToolsEndpoint(
  logs: StartupLogs,
  isRunning: () => boolean,
  timeoutMs: number = ENDPOINT_WAIT_MS,
  signal?: AbortSignal
): Promise<DevToolsEndpoint | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const endpoint = parseDevToolsListening(readStartupLines(logs));
    if (endpoint || !isRunning() || Date.now() >= deadline || signal?.aborted) return endpoint;
    await delay(ENDPOINT_POLL_MS, signal);
  }
}

/**
 * The error for a launch that was aborted (the session was stopped).
 *
 * @returns Launch error
 */
export function launchAbortedError(): ChromeLaunchError {
  return new ChromeLaunchError(CHROME_LAUNCH_ABORTED_MESSAGE);
}

/**
 * End a launch whose session was stopped.
 *
 * @param signal - The launch's abort signal
 * @throws ChromeLaunchError if the signal is aborted
 */
export function throwIfLaunchAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw launchAbortedError();
}

/**
 * Check that the Chrome answering on 127.0.0.1:<port> is the one just
 * launched, so bdg never drives another session's browser.
 *
 * A Chrome that announced 127.0.0.1:<port> but does not answer yet (a slow
 * start, its `/json/version` request timing out) is asked again until the
 * deadline; only an answer from something else is a port conflict. A Chrome
 * that fell back to [::1] is asked once: 127.0.0.1 is held by something else.
 *
 * @param options - Chrome's log positions from before the launch, requested
 *   port (free on 127.0.0.1 and ::1 right before the launch), Chrome's PID,
 *   longest wait for its announcement and its answer, and a signal that ends
 *   the waits and a pending request at once (the session was stopped)
 * @throws ChromeLaunchError: without an issue if `signal` aborts;
 *   CHROME_DIED_AFTER_LAUNCH if Chrome exits first;
 *   PORT_IN_USE if another browser or process answers on the port;
 *   CHROME_LAUNCH_FAILED if Chrome announced nothing and nothing answers, or
 *   announced the port but did not answer on it in time
 */
export async function verifyLaunchedChrome(options: {
  logs: StartupLogs;
  port: number;
  pid: number;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const { logs, port, pid, timeoutMs = ENDPOINT_WAIT_MS, signal } = options;
  const started = Date.now();
  const isRunning = (): boolean => isProcessAlive(pid);
  const endpoint = await waitForDevToolsEndpoint(logs, isRunning, timeoutMs, signal);
  throwIfLaunchAborted(signal);
  if (!endpoint && !isRunning()) throw diedError(port, pid);
  if (!endpoint) return acceptUnannouncedChrome(logs, port, signal);
  if (endpoint.port !== port) {
    throw portTakenError(port, `Chrome listens on port ${endpoint.port} instead`);
  }
  const onLoopback = endpoint.host === '127.0.0.1';
  const deadline = onLoopback ? started + timeoutMs : Date.now();
  const answer = await waitForAnswer(port, deadline, isRunning, signal);
  throwIfLaunchAborted(signal);
  if (answer.kind === 'devtools' && new URL(answer.wsUrl).pathname === endpoint.browserPath) {
    log.debug(`Chrome on port ${port} is the launched one (${endpoint.browserPath})`);
    return;
  }
  if (answer.kind === 'unreachable' && !isRunning()) throw diedError(port, pid);
  if (answer.kind === 'unreachable' && onLoopback) {
    throw slowStartError(port, Date.now() - started);
  }
  throw portTakenError(port, portTakenByReason(answerSource(answer), endpoint.host));
}

/**
 * Ask 127.0.0.1:<port> for its DevTools version until something answers,
 * Chrome exits, the deadline passes (at least once) or `signal` aborts (which
 * also ends a pending request). Each request waits at most until the deadline
 * (but at least MIN_ANSWER_WAIT_MS).
 *
 * @param port - Requested port
 * @param deadline - Time (ms since epoch) to stop asking
 * @param isRunning - Whether Chrome is still running
 * @param signal - Ends the wait early when aborted
 * @returns The first answer, or the last `unreachable` result
 */
async function waitForAnswer(
  port: number,
  deadline: number,
  isRunning: () => boolean,
  signal: AbortSignal | undefined
): Promise<DevToolsProbe> {
  for (;;) {
    const remaining = Math.max(deadline - Date.now(), MIN_ANSWER_WAIT_MS);
    const timeoutMs = Math.min(CDP_HTTP_TIMEOUT_MS, remaining);
    const answer = await probeDevToolsEndpoint(port, undefined, { timeoutMs, signal });
    const done = answer.kind !== 'unreachable' || !isRunning() || Date.now() >= deadline;
    if (done || signal?.aborted) return answer;
    await delay(ENDPOINT_POLL_MS, signal);
  }
}

/**
 * What answered on 127.0.0.1:<port> instead of the launched Chrome.
 *
 * @param answer - The answer
 * @returns A browser, another process, or nothing
 */
function answerSource(answer: DevToolsProbe): 'browser' | 'process' | 'nothing' {
  if (answer.kind === 'devtools') return 'browser';
  return answer.kind === 'not-devtools' ? 'process' : 'nothing';
}

/**
 * Accept a Chrome that did not announce its endpoint, if a browser answers on
 * 127.0.0.1:<port> and nothing listens on [::1]:<port> (two listeners mean a
 * conflict).
 *
 * @param logs - Chrome's log positions (the stderr log is named in messages)
 * @param port - Requested port
 * @param signal - Ends the request early when aborted
 * @throws ChromeLaunchError: without an issue if `signal` aborts;
 *   PORT_IN_USE for a second listener; CHROME_LAUNCH_FAILED if no browser
 *   answers
 */
async function acceptUnannouncedChrome(
  logs: StartupLogs,
  port: number,
  signal: AbortSignal | undefined
): Promise<void> {
  const errLog = logs.files[0]?.file ?? 'chrome-err.log';
  const missing = `Chrome did not print "DevTools listening on" to ${errLog}`;
  const browserWsUrl = await fetchBrowserWsUrl(port, log, { signal });
  throwIfLaunchAborted(signal);
  if (!browserWsUrl) {
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
 * The error for a Chrome that exited during the launch checks.
 *
 * @param port - Requested port
 * @param pid - Chrome's PID
 * @returns Launch error with the CHROME_DIED_AFTER_LAUNCH issue
 */
function diedError(port: number, pid: number): ChromeLaunchError {
  return new ChromeLaunchError(`Chrome died immediately after launch (PID: ${pid})`, {
    issue: { code: 'CHROME_DIED_AFTER_LAUNCH', context: { port, pid } },
  });
}

/**
 * The error for a Chrome that announced the port but did not answer on it in
 * time.
 *
 * @param port - Requested port
 * @param waitedMs - How long bdg waited
 * @returns Launch error with the CHROME_LAUNCH_FAILED issue
 */
function slowStartError(port: number, waitedMs: number): ChromeLaunchError {
  const reason = chromeNotAnsweringReason(port, waitedMs);
  return new ChromeLaunchError(reason, {
    issue: { code: 'CHROME_LAUNCH_FAILED', context: { port, reason } },
  });
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
