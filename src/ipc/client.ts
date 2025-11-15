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
  PeekRequest,
  PeekResponse,
  StartSessionRequest,
  StartSessionResponse,
  StatusRequest,
  StatusResponse,
  StopSessionRequest,
  StopSessionResponse,
} from './session/index.js';
import type { NoType } from './utils/index.js';

import type { TelemetryType } from '@/types.js';

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
    'handshake_response'
  );
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
  return sendRequest<StatusRequest, StatusResponse>(request, 'status', 'status_response');
}

/**
 * Request preview data from the daemon.
 * Returns snapshot of collected telemetry without stopping session.
 *
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
 */
export async function getPeek(): Promise<PeekResponse> {
  const request: PeekRequest = withSession({ type: 'peek_request' });
  return sendRequest<PeekRequest, PeekResponse>(request, 'peek', 'peek_response');
}

/**
 * Request daemon to start a new browser session.
 * Launches Chrome, establishes CDP connection, and begins telemetry collection.
 *
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @param options.port - Custom CDP port (default: 9222)
 * @param options.timeout - Auto-stop timeout in seconds
 * @param options.telemetry - Telemetry collectors to enable
 * @param options.includeAll - Include all data (disable filtering)
 * @param options.userDataDir - Custom Chrome user data directory
 * @param options.maxBodySize - Max response body size in MB (default: 5)
 * @param options.headless - Launch Chrome in headless mode
 * @param options.chromeWsUrl - Connect to existing Chrome instance
 * @returns Start session response with worker and Chrome PIDs
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
 *   console.log('Session started, worker PID:', response.data.workerPid);
 * }
 * ```
 */
export async function startSession(
  url: string,
  options?: {
    port?: number;
    timeout?: number;
    telemetry?: TelemetryType[];
    includeAll?: boolean;
    userDataDir?: string;
    maxBodySize?: number;
    headless?: boolean;
    chromeWsUrl?: string;
  }
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
    }),
  });

  return sendRequest<StartSessionRequest, StartSessionResponse>(
    request,
    'start session',
    'start_session_response'
  );
}

/**
 * Request session stop from the daemon.
 * Stops telemetry collection, closes Chrome, and writes output file.
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
  return sendRequest<StopSessionRequest, StopSessionResponse>(
    request,
    'stop session',
    'stop_session_response'
  );
}

/**
 * Send a command to the worker process.
 * Internal helper for worker commands (details, CDP calls).
 *
 * @param commandName - Name of the command to send
 * @param params - Command parameters (without type field)
 * @returns Command response from worker
 * @throws Error if connection fails or command execution fails
 */
async function sendCommand<T extends CommandName>(
  commandName: T,
  params: NoType<(typeof COMMANDS)[T]['requestSchema']>
): Promise<ClientResponse<T>> {
  const request: ClientRequest<T> = {
    ...params,
    type: `${commandName}_request` as const,
    sessionId: withSession({ type: '' }).sessionId,
  } as ClientRequest<T>;

  return sendRequest<ClientRequest<T>, ClientResponse<T>>(
    request,
    commandName,
    `${commandName}_response`
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
): Promise<ClientResponse<'worker_details'>> {
  return sendCommand('worker_details', { itemType: type, id });
}

/**
 * Execute arbitrary CDP method via the daemon's worker.
 * Forwards CDP commands to the worker's active CDP connection.
 *
 * @param method - CDP method name (e.g., 'Network.getCookies')
 * @param params - Optional method parameters
 * @returns Response with CDP method result
 * @throws Error if connection fails or CDP method fails
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
  return sendCommand('cdp_call', { method, ...(params && { params }) });
}
