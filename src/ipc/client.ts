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

import { getQuickIPCRequestTimeout } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
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
export async function getStatus(): Promise<StatusResponse> {
  const request: StatusRequest = withSession({ type: 'status_request' });
  return sendRequest<StatusRequest, StatusResponse>(
    request,
    'status',
    'status_response',
    getQuickIPCRequestTimeout()
  );
}

/**
 * Request preview data from the daemon.
 * Returns snapshot of collected telemetry without stopping session.
 *
 * @param options - Optional parameters for the peek request (lastN: number of items, 0 = all)
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
}): Promise<PeekResponse> {
  const request: PeekRequest = withSession({
    type: 'peek_request',
    ...(options?.lastN !== undefined && { lastN: options.lastN }),
    ...(options?.only && { only: options.only }),
    ...(options?.withHeaders && { withHeaders: true }),
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
  return sendRequest<HARDataRequest, HARDataResponse>(request, 'HAR data', 'har_data_response');
}

/**
 * Request daemon to start a new browser session.
 * Launches Chrome, establishes CDP connection, and begins telemetry collection.
 *
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @returns Start session response with daemon and Chrome PIDs
 * @throws Error if connection fails, session already running, or Chrome launch fails
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
  options?: SessionOptions
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
    }),
  });

  await assertResponsive();
  return sendRequest<StartSessionRequest, StartSessionResponse>(
    request,
    'start session',
    'start_session_response'
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
 * @returns Command response from the session
 * @throws Error if connection fails or command execution fails
 */
async function sendCommand<T extends CommandName>(
  commandName: T,
  params: NoType<(typeof COMMANDS)[T]['requestSchema']>,
  timeoutMs?: number
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
    timeoutMs
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
 * @returns Response with CDP method result
 * @throws Error if connection fails; CommandError (102) when the page was busy and its scripts were terminated
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
  params?: Record<string, unknown>
): Promise<ClientResponse<'cdp_call'>> {
  const response = await sendCommand('cdp_call', { method, ...(params && { params }) });
  if (response.status === 'error' && response.exitCode === EXIT_CODES.CDP_TIMEOUT) {
    throw new CommandError(
      response.error ?? `${method} timed out`,
      response.suggestion ? { suggestion: response.suggestion } : {},
      EXIT_CODES.CDP_TIMEOUT
    );
  }
  return response;
}

/**
 * Evaluate a JavaScript expression in the active page context via the daemon.
 */
export async function domEval(script: string): Promise<ClientResponse<'dom_eval'>> {
  return sendCommand('dom_eval', { script });
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

/** Run form discovery and return the raw structured form data. */
export async function domFormDiscover(): Promise<ClientResponse<'dom_form_discover'>> {
  return sendCommand('dom_form_discover', {});
}
