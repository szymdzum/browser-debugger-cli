/**
 * IPC Client
 *
 * Public API for communicating with the daemon via Unix socket.
 * Provides high-level functions for session lifecycle and queries.
 */

import type { ClientRequest, ClientResponse, CommandName } from './protocol/index.js';
import type { COMMANDS } from './protocol/index.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  HARDataRequest,
  HARDataResponse,
  PeekRequest,
  PeekResponse,
  SessionOptions,
  StartSessionRequest,
  StartSessionResponse,
  StatusRequest,
  StatusResponse,
  StopSessionRequest,
  StopSessionResponse,
} from './session/index.js';
import type { NoType } from './utils/index.js';

import { getIPCRequestTimeout, getQuickIPCRequestTimeout } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import type { CdpCollectParams, CdpEventsCommand } from '@/ipc/protocol/cdpEventTypes.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { sendRequest } from './transport/index.js';
import { withSession } from './utils/index.js';

/**
 * Connect to the daemon and perform handshake.
 * Verifies daemon is running and ready to accept commands.
 *
 * @returns Handshake response with connection status
 * @throws Error if connection fails or times out
 *
 * @example
 * ```typescript
 * const response = await connectToDaemon();
 * if (response.status === 'ok') {
 *   console.log('Connected:', response.message);
 * }
 * ```
 */
export async function connectToDaemon(): Promise<HandshakeResponse> {
  const request: HandshakeRequest = withSession({ type: 'handshake_request' });
  return sendRequest<HandshakeRequest, HandshakeResponse>(
    request,
    'handshake',
    'handshake_response',
    getQuickIPCRequestTimeout()
  );
}

/**
 * Make sure the daemon answers before sending a request that may take long
 * (page work, start, stop): a frozen daemon fails after the quick timeout
 * instead of the full one.
 *
 * @throws IPCTimeoutError (quick timeout) when the daemon does not answer
 */
async function assertResponsive(): Promise<void> {
  await connectToDaemon();
}

/**
 * Request status information from the daemon.
 * Returns daemon state, session metadata, and activity metrics.
 *
 * @param socketPath - Daemon socket to ask (default: the selected session's)
 * @param options - `tabMove`: take a move of the session to another tab that
 *   no command reported yet (`tabMoved`), for a command that reports it
 * @returns Status response with daemon and session information
 * @throws Error if connection fails or times out
 *
 * @example
 * ```typescript
 * const response = await getStatus();
 * if (response.status === 'ok' && response.data) {
 *   console.log('Daemon PID:', response.data.daemonPid);
 *   console.log('Session active:', !!response.data.sessionPid);
 * }
 * ```
 */
export async function getStatus(
  socketPath?: string,
  options: { tabMove?: boolean } = {}
): Promise<StatusResponse> {
  const request: StatusRequest = withSession({
    type: 'status_request',
    ...(options.tabMove && { tabMove: true }),
  });
  return sendRequest<StatusRequest, StatusResponse>(
    request,
    'status',
    'status_response',
    getQuickIPCRequestTimeout(),
    socketPath
  );
}

/**
 * Request preview data from the daemon.
 * Returns snapshot of collected telemetry without stopping session.
 *
 * @param options - Optional parameters for the peek request (lastN: number of items, 0 = all;
 *   tabMove: take a move of the session to another tab that no command reported yet)
 * @returns Peek response with preview data
 * @throws Error if connection fails, times out, or no active session
 *
 * @example
 * ```typescript
 * const response = await getPeek();
 * if (response.status === 'ok' && response.data) {
 *   console.log('Network requests:', response.data.preview.data.network?.length);
 *   console.log('Console messages:', response.data.preview.data.console?.length);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Get all messages (no limit)
 * const response = await getPeek({ lastN: 0 });
 * ```
 */
export async function getPeek(options?: {
  lastN?: number;
  only?: 'network' | 'console';
  withHeaders?: boolean;
  tabMove?: boolean;
}): Promise<PeekResponse> {
  const request: PeekRequest = withSession({
    type: 'peek_request',
    ...(options?.lastN !== undefined && { lastN: options.lastN }),
    ...(options?.only && { only: options.only }),
    ...(options?.withHeaders && { withHeaders: true }),
    ...(options?.tabMove && { tabMove: true }),
  });
  return sendRequest<PeekRequest, PeekResponse>(
    request,
    'peek',
    'peek_response',
    getQuickIPCRequestTimeout()
  );
}

/**
 * Request network data for HAR export from the daemon.
 * Returns all collected network requests without stopping session.
 *
 * @returns HAR data response with network requests
 * @throws Error if connection fails, times out, or no active session
 *
 * @example
 * ```typescript
 * const response = await getHARData();
 * if (response.status === 'ok' && response.data) {
 *   console.log('Total requests:', response.data.requests.length);
 * }
 * ```
 */
export async function getHARData(): Promise<HARDataResponse> {
  const request: HARDataRequest = withSession({ type: 'har_data_request' });
  await assertResponsive();
  return sendRequest<HARDataRequest, HARDataResponse>(request, 'HAR data', 'har_data_response');
}

/**
 * Request daemon to start a new browser session.
 * Launches Chrome, establishes CDP connection, and begins telemetry collection.
 *
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @param signal - Cancels the start: closes the connection, so the daemon
 *   abandons the session it is starting
 * @returns Start session response with daemon and Chrome PIDs
 * @throws Error if connection fails, session already running, or Chrome launch fails
 * @throws IPCCancelledError if `signal` aborts first
 *
 * @example
 * ```typescript
 * const response = await startSession('http://localhost:3000', {
 *   timeout: 30,
 *   headless: true,
 *   maxBodySize: 10
 * });
 * if (response.status === 'ok' && response.data) {
 *   console.log('Session started, daemon PID:', response.data.daemonPid);
 * }
 * ```
 */
export async function startSession(
  url: string,
  options?: SessionOptions,
  signal?: AbortSignal
): Promise<StartSessionResponse> {
  const request: StartSessionRequest = withSession({
    type: 'start_session_request',
    url,
    ...(options && {
      port: options.port,
      timeout: options.timeout,
      telemetry: options.telemetry,
      includeAll: options.includeAll,
      userDataDir: options.userDataDir,
      maxBodySize: options.maxBodySize,
      headless: options.headless,
      chromeWsUrl: options.chromeWsUrl,
      chromeFlags: options.chromeFlags,
      viewport: options.viewport,
      colorScheme: options.colorScheme,
      dialog: options.dialog,
      state: options.state,
    }),
  });

  await assertResponsive();
  return sendRequest<StartSessionRequest, StartSessionResponse>(
    request,
    'start session',
    'start_session_response',
    undefined,
    undefined,
    signal
  );
}

/**
 * Request session stop from the daemon.
 * Stops telemetry collection and closes Chrome.
 *
 * @returns Stop session response with termination status
 * @throws Error if connection fails, times out, or no active session
 *
 * @example
 * ```typescript
 * const response = await stopSession();
 * if (response.status === 'ok') {
 *   console.log('Session stopped:', response.message);
 * }
 * ```
 */
export async function stopSession(): Promise<StopSessionResponse> {
  const request: StopSessionRequest = withSession({ type: 'stop_session_request' });
  await assertResponsive();
  return sendRequest<StopSessionRequest, StopSessionResponse>(
    request,
    'stop session',
    'stop_session_response'
  );
}

/**
 * Send a command to the daemon's session.
 * Internal helper for session commands (details, CDP calls).
 *
 * @param commandName - Name of the command to send
 * @param params - Command parameters (without type field)
 * @param timeoutMs - How long to wait (default: IPC timeout; page work can take long)
 * @param signal - Cancels the command: closes the connection, which the daemon notices
 * @returns Command response from the session
 * @throws Error if connection fails or command execution fails
 * @throws IPCCancelledError if `signal` aborts first
 */
async function sendCommand<T extends CommandName>(
  commandName: T,
  params: NoType<(typeof COMMANDS)[T]['requestSchema']>,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<ClientResponse<T>> {
  const request: ClientRequest<T> = {
    ...params,
    type: `${commandName}_request` as const,
    sessionId: withSession({ type: '' }).sessionId,
  } as ClientRequest<T>;

  if (timeoutMs === undefined || timeoutMs > getQuickIPCRequestTimeout()) await assertResponsive();
  return sendRequest<ClientRequest<T>, ClientResponse<T>>(
    request,
    commandName,
    `${commandName}_response`,
    timeoutMs,
    undefined,
    signal
  );
}

/**
 * Get details for a specific network request or console message.
 * Retrieves full data (headers, body, stack trace) for a telemetry item.
 *
 * @param type - Type of item to retrieve ('network' or 'console')
 * @param id - Unique identifier of the item
 * @returns Response with full item details
 * @throws Error if connection fails or item not found
 *
 * @example
 * ```typescript
 * const response = await getDetails('network', 'req-123');
 * if (response.status === 'ok' && response.data) {
 *   console.log('Full request:', response.data.item);
 * }
 * ```
 */
export async function getDetails(
  type: 'network' | 'console',
  id: string
): Promise<ClientResponse<'session_details'>> {
  return sendCommand('session_details', { itemType: type, id }, getQuickIPCRequestTimeout());
}

/**
 * Get headers for a network request.
 * Defaults to main document navigation if no ID specified.
 *
 * @param options - Optional request ID and header name filter
 * @returns Response with request and response headers
 * @throws Error if connection fails or request not found
 *
 * @example
 * ```typescript
 * const response = await getNetworkHeaders();
 * if (response.status === 'ok' && response.data) {
 *   console.log('Response headers:', response.data.responseHeaders);
 * }
 * ```
 *
 * @example
 * ```typescript
 * const response = await getNetworkHeaders({ id: 'ABC-123' });
 * ```
 *
 * @example
 * ```typescript
 * const response = await getNetworkHeaders({ headerName: 'content-security-policy' });
 * ```
 */
export async function getNetworkHeaders(options?: {
  id?: string;
  headerName?: string;
}): Promise<ClientResponse<'session_network_headers'>> {
  return sendCommand(
    'session_network_headers',
    {
      ...(options?.id && { id: options.id }),
      ...(options?.headerName && { headerName: options.headerName }),
    },
    getQuickIPCRequestTimeout()
  );
}

/**
 * Execute arbitrary CDP method via the daemon.
 * Forwards CDP commands to the session's active CDP connection.
 *
 * @param method - CDP method name (e.g., 'Network.getCookies')
 * @param params - Optional method parameters
 * @param options - `isolated`: a bdg page script, run in bdg's isolated world
 *   (`Runtime.evaluate`, `DOM.resolveNode`); `collect`: events to collect
 *   while the method runs (the request waits for its timeout)
 * @returns Response with CDP method result
 * @throws Error if connection fails; CommandError (102) when the page was busy and its scripts were terminated, (107) when the page crashed
 *
 * @example
 * ```typescript
 * const response = await callCDP('Network.getCookies', {});
 * if (response.status === 'ok' && response.data) {
 *   console.log('Cookies:', response.data.result);
 * }
 * ```
 */
export async function callCDP(
  method: string,
  params?: Record<string, unknown>,
  options: { isolated?: boolean; collect?: CdpCollectParams } = {}
): Promise<ClientResponse<'cdp_call'>> {
  const response = await sendCommand(
    'cdp_call',
    {
      method,
      ...(params && { params }),
      ...(options.isolated && { isolated: true }),
      ...(options.collect && { collect: options.collect }),
    },
    options.collect && waitingTimeoutMs(options.collect.timeoutMs)
  );
  const fatal = [EXIT_CODES.CDP_TIMEOUT, EXIT_CODES.PAGE_CRASHED] as number[];
  if (response.status === 'error' && response.exitCode && fatal.includes(response.exitCode)) {
    throw new CommandError(
      response.error ?? `${method} failed`,
      response.suggestion ? { suggestion: response.suggestion } : {},
      response.exitCode
    );
  }
  return response;
}

/**
 * Send a CDP call for one of bdg's own page scripts: `Runtime.evaluate` and
 * `DOM.resolveNode` run in bdg's isolated world, so a page that replaced
 * built-ins (`querySelectorAll`, `JSON.stringify`) cannot change what they
 * find or return.
 *
 * @param method - CDP method name
 * @param params - Method parameters
 * @returns Response with the CDP method result
 * @throws Like {@link callCDP}
 */
export function callBdgScript(
  method: string,
  params?: Record<string, unknown>
): Promise<ClientResponse<'cdp_call'>> {
  return callCDP(method, params, { isolated: true });
}

/**
 * Evaluate a JavaScript expression in the active page (or one of its iframes) via the daemon.
 *
 * @param script - JavaScript expression
 * @param frame - Iframe to evaluate in
 * @param full - `--full`: copy an object or array result with every entry
 * @returns The daemon's response
 */
export async function domEval(
  script: string,
  frame?: string,
  full?: boolean
): Promise<ClientResponse<'dom_eval'>> {
  return sendCommand('dom_eval', {
    script,
    ...(frame !== undefined && { frame }),
    ...(full && { full }),
  });
}

/**
 * List the page's iframes via the daemon.
 */
export async function domFrames(): Promise<ClientResponse<'dom_frames'>> {
  return sendCommand('dom_frames', {});
}

/**
 * Fill a form field. The session subscribes to CDP events and optionally waits for
 * network stability — CLI never opens its own CDP connection.
 */
export async function domFill(
  params: NoType<(typeof COMMANDS)['dom_fill']['requestSchema']>
): Promise<ClientResponse<'dom_fill'>> {
  return sendCommand('dom_fill', params);
}

/** Click an element with optional post-action stability wait. */
export async function domClick(
  params: NoType<(typeof COMMANDS)['dom_click']['requestSchema']>
): Promise<ClientResponse<'dom_click'>> {
  return sendCommand('dom_click', params);
}

/** Submit a form with navigation/network-idle waiting. */
export async function domSubmit(
  params: NoType<(typeof COMMANDS)['dom_submit']['requestSchema']>
): Promise<ClientResponse<'dom_submit'>> {
  return sendCommand('dom_submit', params);
}

/** Dispatch a key event on an element. */
export async function domPressKey(
  params: NoType<(typeof COMMANDS)['dom_press_key']['requestSchema']>
): Promise<ClientResponse<'dom_press_key'>> {
  return sendCommand('dom_press_key', params);
}

/** Scroll the page or an element into view. */
export async function domScroll(
  params: NoType<(typeof COMMANDS)['dom_scroll']['requestSchema']>
): Promise<ClientResponse<'dom_scroll'>> {
  return sendCommand('dom_scroll', params);
}

/**
 * Navigate the page (navigate, reload, back, forward) and wait for it.
 *
 * @param params - Action, URL and wait flag
 * @returns Where the page is now
 */
export async function pageNavigate(
  params: NoType<(typeof COMMANDS)['page_navigate']['requestSchema']>
): Promise<ClientResponse<'page_navigate'>> {
  return sendCommand('page_navigate', params);
}

/**
 * Change the page emulation (viewport, color scheme) or clear it.
 *
 * @param params - What to set, or reset
 * @returns Emulation and what the page now has
 */
export async function pageEmulate(
  params: NoType<(typeof COMMANDS)['page_emulate']['requestSchema']>
): Promise<ClientResponse<'page_emulate'>> {
  return sendCommand('page_emulate', params);
}

/**
 * List the page targets (tabs and windows) of the session's Chrome.
 *
 * @returns Tabs in index order
 */
export async function pageTabs(): Promise<ClientResponse<'page_tabs'>> {
  return sendCommand('page_tabs', {});
}

/**
 * Make another tab the session's.
 *
 * @param params - Index, target id or part of the URL
 * @returns The tab switched to
 */
export async function pageSwitch(
  params: NoType<(typeof COMMANDS)['page_switch']['requestSchema']>
): Promise<ClientResponse<'page_switch'>> {
  return sendCommand('page_switch', params);
}

/**
 * Close a tab (the session's own when none is given).
 *
 * @param params - Index, target id or part of the URL
 * @returns The closed tab and the session's tab now
 */
export async function pageClose(
  params: NoType<(typeof COMMANDS)['page_close']['requestSchema']>
): Promise<ClientResponse<'page_close'>> {
  return sendCommand('page_close', params);
}

/**
 * Read the session's cookies and storage (values included, for the state file).
 *
 * @param params - Origins to read (default: the page's)
 * @returns The state
 */
export async function stateSave(
  params: NoType<(typeof COMMANDS)['state_save']['requestSchema']>
): Promise<ClientResponse<'state_save'>> {
  return sendCommand('state_save', params);
}

/**
 * Restore cookies and storage into the session, then reload unless asked not to.
 *
 * @param params - State and whether to reload
 * @returns What was restored (counts)
 */
export async function stateLoad(
  params: NoType<(typeof COMMANDS)['state_load']['requestSchema']>
): Promise<ClientResponse<'state_load'>> {
  return sendCommand('state_load', params);
}

/** Run form discovery and return the raw structured form data. */
export async function domFormDiscover(): Promise<ClientResponse<'dom_form_discover'>> {
  return sendCommand('dom_form_discover', {});
}

/** List the event listeners that run for an element. */
export async function domListeners(
  params: NoType<(typeof COMMANDS)['dom_listeners']['requestSchema']>
): Promise<ClientResponse<'dom_listeners'>> {
  return sendCommand('dom_listeners', params);
}

/** Positions, sizes and visibility of elements. */
export async function domLayout(
  params: NoType<(typeof COMMANDS)['dom_layout']['requestSchema']>
): Promise<ClientResponse<'dom_layout'>> {
  return sendCommand('dom_layout', params);
}

/** Page-wide checks: contrast, overflow, layers, animations. */
export async function domAudit(
  params: NoType<(typeof COMMANDS)['dom_audit']['requestSchema']>
): Promise<ClientResponse<'dom_audit'>> {
  return sendCommand('dom_audit', params);
}

/** Find text in the page's stylesheets. */
export async function cssSearch(
  params: NoType<(typeof COMMANDS)['css_search']['requestSchema']>
): Promise<ClientResponse<'css_search'>> {
  return sendCommand('css_search', params);
}

/** What one element looks like: styles, box, layout and child tree. */
export async function domInspect(
  params: NoType<(typeof COMMANDS)['dom_inspect']['requestSchema']>
): Promise<ClientResponse<'dom_inspect'>> {
  return sendCommand('dom_inspect', params);
}

/**
 * Capture the page or one element; the daemon puts back the emulation the
 * capture changed before it answers.
 *
 * @param params - What to capture and how
 * @param signal - Cancels the capture (the daemon skips it and only restores)
 * @returns The image and what was captured
 * @throws IPCCancelledError if `signal` aborts first
 */
export async function domScreenshot(
  params: NoType<(typeof COMMANDS)['dom_screenshot']['requestSchema']>,
  signal?: AbortSignal
): Promise<ClientResponse<'dom_screenshot'>> {
  return sendCommand('dom_screenshot', params, undefined, signal);
}

/** Time the client gives `dom wait` beyond its --timeout (the daemon reports the timeout first) */
const WAIT_IPC_MARGIN_MS = 10_000;

/**
 * IPC timeout of a request that waits by its own options, so the daemon
 * reports that wait running out first.
 *
 * @param waitMs - The request's own wait
 * @returns Timeout in milliseconds
 */
function waitingTimeoutMs(waitMs: number): number {
  return Math.max(getIPCRequestTimeout(), waitMs + WAIT_IPC_MARGIN_MS);
}

/**
 * Start buffering CDP events, read the buffer, or stop
 * (`bdg cdp --listen`, `--events`, `--unlisten`).
 *
 * @param request - What to do
 * @returns The daemon's response
 */
export async function cdpEvents(request: CdpEventsCommand): Promise<ClientResponse<'cdp_events'>> {
  const waitMs = request.action === 'read' ? (request.waitMs ?? 0) : 0;
  return sendCommand('cdp_events', request, waitMs > 0 ? waitingTimeoutMs(waitMs) : undefined);
}

/**
 * Wait until elements appear, become visible, contain a text or are gone,
 * and/or the page has loaded.
 *
 * @param params - Condition and timeout
 * @returns What the page showed once the condition was met
 */
export async function domWait(
  params: NoType<(typeof COMMANDS)['dom_wait']['requestSchema']>
): Promise<ClientResponse<'dom_wait'>> {
  return sendCommand('dom_wait', params, waitingTimeoutMs(params.timeout));
}
