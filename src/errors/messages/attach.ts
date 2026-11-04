/**
 * Attach and external Chrome error messages.
 */

import { getSessionBaseDir } from '@/session/paths.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { type ErrorWithSuggestion } from './shared.js';

/**
 * The Chrome of `--chrome-ws-url` does not answer on its HTTP endpoint.
 *
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @param secure - Whether a wss: URL was given
 */
export function externalChromeUnreachableError(
  endpoint: string,
  secure: boolean
): ErrorWithSuggestion {
  return {
    message: `Cannot reach the Chrome DevTools endpoint at ${endpoint}`,
    suggestion: secure
      ? 'Chrome itself serves ws:// only; use ws://host:port/... unless a TLS proxy is in front of it'
      : 'Check that Chrome runs with --remote-debugging-port and is reachable from here',
  };
}

/** How to reach a Chrome endpoint given directly with `--chrome-ws-url` */
export const CHROME_ENDPOINT_SUGGESTION =
  "Check that the URL is right and that Chrome runs with --remote-debugging-port; the browser's WebSocket URL is listed at http://<host>:<port>/json/version";

/** Failures that mean the endpoint itself could not be reached */
const CHROME_CONNECTION_FAILURE =
  /Failed to connect|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo|WebSocket|socket hang up/i;

/**
 * Whether an error message is a connection failure at a Chrome endpoint.
 *
 * @param message - Error message
 */
export function isChromeConnectionFailure(message: string): boolean {
  return CHROME_CONNECTION_FAILURE.test(message);
}

/**
 * A direct `--chrome-ws-url` connection failed (DNS, refused, or a closed
 * handshake): the URL is the only thing that names the browser.
 *
 * @param message - The connection error
 */
export function chromeConnectionFailedError(message: string): ErrorWithSuggestion {
  return { message, suggestion: CHROME_ENDPOINT_SUGGESTION };
}

/**
 * Something answers on the `--chrome-ws-url` endpoint, but it is not Chrome's
 * DevTools HTTP endpoint (e.g. a web server on that port).
 *
 * @param endpoint - e.g. http://127.0.0.1:3000
 */
export function notDevToolsEndpointError(endpoint: string): ErrorWithSuggestion {
  return {
    message: `${endpoint} answers, but it is not a Chrome DevTools endpoint (no /json/version)`,
    suggestion:
      "Give Chrome's debugging port (the --remote-debugging-port it was started with), not the page's port",
  };
}

/**
 * Another running bdg session uses the Chrome (or tab) `--chrome-ws-url`
 * points to.
 *
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @param owner - The other session: name (null for a default session),
 *   directory, base directory and whether it launched that Chrome
 */
export function chromeInUseBySessionError(
  endpoint: string,
  owner: { name: string | null; dir: string; baseDir: string; launched: boolean }
): ErrorWithSuggestion {
  const label = owner.name === null ? 'the default bdg session' : `bdg session "${owner.name}"`;
  const what = owner.launched ? 'was launched by' : 'has its tab driven by';
  const envPrefix =
    owner.baseDir === getSessionBaseDir() ? '' : `BDG_SESSION_DIR=${owner.baseDir} `;
  const ownerCommand = (command: string): string => envPrefix + sessionCommand(command, owner.name);
  return {
    message: `The Chrome at ${endpoint} ${what} ${label} (${owner.dir}); attaching would take it over`,
    suggestion: `Use that session (${ownerCommand('bdg status')}), stop it first (${ownerCommand('bdg stop')}), or attach to another Chrome or tab (a page URL from ${endpoint}/json/list)`,
  };
}

/**
 * The page id of a `--chrome-ws-url` page URL does not exist.
 *
 * @param id - Page id from the URL
 * @param endpoint - e.g. http://127.0.0.1:9222
 */
export function externalPageNotFoundError(id: string, endpoint: string): ErrorWithSuggestion {
  return {
    message: `No page with id ${id} in the Chrome at ${endpoint}`,
    suggestion: `List its pages: curl -s ${endpoint}/json/list`,
  };
}

/**
 * The browser id of a `--chrome-ws-url` browser URL is not this Chrome's.
 *
 * @param endpoint - e.g. http://127.0.0.1:9222
 * @param actual - The Chrome's browser WebSocket URL
 */
export function externalBrowserIdMismatchError(
  endpoint: string,
  actual: string
): ErrorWithSuggestion {
  return {
    message: `The Chrome at ${endpoint} has a different browser id (it was restarted, or the URL is from another Chrome)`,
    suggestion: `Use its current URL: ${sessionCommand(`bdg <url> --chrome-ws-url ${actual}`)}`,
  };
}

/**
 * Options that only apply when bdg launches Chrome, given with `--chrome-ws-url`.
 *
 * @param options - The conflicting options, e.g. ["--port", "-u"]
 */
export function chromeWsUrlConflictError(options: string[]): ErrorWithSuggestion {
  return {
    message: `${options.join(' and ')} cannot be used with --chrome-ws-url (the running Chrome already has its port, profile and window mode)`,
    suggestion: 'Drop them, or let bdg launch Chrome without --chrome-ws-url',
  };
}

/** How to let `bdg attach` reach a Chrome (#473) */
const REMOTE_DEBUGGING_SUGGESTION =
  'Enable remote debugging at chrome://inspect/#remote-debugging in Chrome (or start Chrome with --remote-debugging-port), or pass --chrome-ws-url <url>, or --user-data-dir <dir> for another Chromium profile';

/**
 * `bdg attach` found no `DevToolsActivePort` file: remote debugging is off.
 *
 * @param file - The file looked for
 */
export function devToolsActivePortMissingError(file: string): ErrorWithSuggestion {
  return {
    message: `No DevToolsActivePort file at ${file}: Chrome has remote debugging off`,
    suggestion: REMOTE_DEBUGGING_SUGGESTION,
  };
}

/**
 * `bdg attach` found a `DevToolsActivePort` file it cannot read or parse.
 *
 * @param file - The file
 */
export function devToolsActivePortUnreadableError(file: string): ErrorWithSuggestion {
  return {
    message: `The DevToolsActivePort file at ${file} could not be read (expected a port, then /devtools/browser/<id>)`,
    suggestion: REMOTE_DEBUGGING_SUGGESTION,
  };
}

/**
 * No Chrome answers on the port a `DevToolsActivePort` file names (remote
 * debugging turned off, or Chrome closed, after it wrote the file; the port
 * may be free or another program's now).
 *
 * @param file - The file
 * @param endpoint - host:port it names
 */
export function staleDevToolsActivePortError(file: string, endpoint: string): ErrorWithSuggestion {
  return {
    message: `No Chrome answers at ${endpoint}, the port ${file} names (a stale file): remote debugging was turned off or Chrome closed`,
    suggestion: REMOTE_DEBUGGING_SUGGESTION,
  };
}

/** How to get past Chrome's "Allow remote debugging?" prompt */
const ALLOW_PROMPT_SUGGESTION =
  "Run the command again and click Allow in Chrome's remote debugging prompt";

/** The user declined Chrome's "Allow remote debugging?" prompt for `bdg attach`. */
export function remoteDebuggingDeclinedError(): ErrorWithSuggestion {
  return {
    message: 'Chrome refused the connection: the remote debugging prompt was declined',
    suggestion: ALLOW_PROMPT_SUGGESTION,
  };
}

/**
 * Chrome's "Allow remote debugging?" prompt got no answer in time.
 *
 * @param seconds - How long bdg waited
 */
export function remoteDebuggingUnansweredError(seconds: number): ErrorWithSuggestion {
  return {
    message: `Chrome's remote debugging prompt was not answered within ${seconds}s`,
    suggestion: ALLOW_PROMPT_SUGGESTION,
  };
}

/** `bdg attach` with both `--chrome-ws-url` and `--user-data-dir`. */
export function attachEndpointConflictError(): ErrorWithSuggestion {
  return {
    message: '--chrome-ws-url and --user-data-dir both name the Chrome to attach to',
    suggestion:
      'Pass one of them: --chrome-ws-url names the endpoint, --user-data-dir the profile whose DevToolsActivePort is read',
  };
}

/**
 * `BDG_ATTACH_REQUIRE_WS_URL` is set and `bdg attach` was given neither
 * `--chrome-ws-url` nor `--user-data-dir`.
 */
export function attachWsUrlRequiredError(): ErrorWithSuggestion {
  return {
    message:
      'BDG_ATTACH_REQUIRE_WS_URL is set: bdg attach does not look for a running Chrome through its DevToolsActivePort file',
    suggestion:
      'Pass --chrome-ws-url (a debugging port, http://host:port or ws://…/devtools/browser/<id>) of a Chrome you launched yourself',
  };
}

/**
 * No tab's URL or title contains the `bdg attach` pattern.
 *
 * @param pattern - The pattern
 * @param tabList - The tabs, one `[i] title — url` line each
 */
export function noTabMatchesError(pattern: string, tabList: string): ErrorWithSuggestion {
  return {
    message: `No tab matches "${pattern}"`,
    suggestion: `Open tabs:\n${tabList}\nAttach by index: bdg attach <index>`,
  };
}

/**
 * Several tabs match the `bdg attach` pattern.
 *
 * @param pattern - The pattern
 * @param candidates - The matching tabs, one `[i] title — url` line each
 * @param count - How many match
 */
export function severalTabsMatchError(
  pattern: string,
  candidates: string,
  count: number
): ErrorWithSuggestion {
  return {
    message: `${count} tabs match "${pattern}"`,
    suggestion: `Use an index or a longer pattern:\n${candidates}`,
  };
}

/**
 * A `bdg attach` index past the last tab.
 *
 * @param index - The index
 * @param tabList - The tabs, one `[i] title — url` line each
 * @param count - How many tabs are open
 */
export function attachIndexOutOfRangeError(
  index: number,
  tabList: string,
  count: number
): ErrorWithSuggestion {
  return {
    message: `No tab at index ${index} (${count} tabs open)`,
    suggestion: `Open tabs:\n${tabList}`,
  };
}

/**
 * `bdg stop --kill-chrome` on a session `bdg attach` started: the browser is the user's.
 */
export function killAttachedChromeError(): ErrorWithSuggestion {
  return {
    message: '--kill-chrome is refused for an attached session: the Chrome is not bdg’s',
    suggestion: 'Run bdg stop: it detaches and leaves the tab and Chrome as they are',
  };
}

/**
 * Moving an attached session (`bdg attach`) to another tab: it holds one
 * connection to its tab.
 */
export function attachedTabSwitchError(): ErrorWithSuggestion {
  return {
    message: 'A session started with bdg attach stays on its tab',
    suggestion: 'Stop it (bdg stop) and attach to the other tab: bdg attach <pattern|index>',
  };
}

/**
 * An empty `bdg attach` pattern: it would match every tab.
 *
 * @param tabList - The tabs, one `[i] title — url` line each
 */
export function emptyTabPatternError(tabList: string): ErrorWithSuggestion {
  return {
    message: 'The tab pattern is empty',
    suggestion: `Give an index or part of the URL or title:\n${tabList}`,
  };
}

/**
 * A command that needs a rendered frame, on an attached tab Chrome does not
 * render (in the background, or its main thread busy): it would wait
 * forever (`bdg attach`).
 */
export function backgroundTabError(): ErrorWithSuggestion {
  return {
    message: 'The attached tab is not rendering (in the background, or busy)',
    suggestion:
      'Bring the tab to the front in Chrome, or wait until the page is idle, then run the command again',
  };
}
