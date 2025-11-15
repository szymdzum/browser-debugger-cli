import { randomUUID } from 'crypto';

import type { COMMANDS, CommandName, ClientRequest, ClientResponse } from './commands.js';
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
} from './types.js';

import type { TelemetryType } from '@/types.js';

import { sendRequest } from './transport.js';

function withSession<T extends { type: string }>(payload: T): T & { sessionId: string } {
  return { ...payload, sessionId: randomUUID() } as T & { sessionId: string };
}

export type NoType<T> = Omit<T, 'type'>;

/**
 * Connect to the daemon and perform handshake.
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
 */
export async function getStatus(): Promise<StatusResponse> {
  const request: StatusRequest = withSession({ type: 'status_request' });
  return sendRequest<StatusRequest, StatusResponse>(request, 'status', 'status_response');
}

/**
 * Request preview data from the daemon.
 */
export async function getPeek(): Promise<PeekResponse> {
  const request: PeekRequest = withSession({ type: 'peek_request' });
  return sendRequest<PeekRequest, PeekResponse>(request, 'peek', 'peek_response');
}

/**
 * Request daemon to start a new browser session.
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
 * Internal: generic command sender.
 */
async function sendCommand<T extends CommandName>(
  commandName: T,
  params: NoType<(typeof COMMANDS)[T]['requestSchema']>
): Promise<ClientResponse<T>> {
  const request: ClientRequest<T> = {
    ...params,
    type: `${commandName}_request` as const,
    sessionId: randomUUID(),
  } as ClientRequest<T>;

  return sendRequest<ClientRequest<T>, ClientResponse<T>>(
    request,
    commandName,
    `${commandName}_response`
  );
}

/**
 * Get details (network/console) from worker.
 */
export async function getDetails(
  type: 'network' | 'console',
  id: string
): Promise<ClientResponse<'worker_details'>> {
  return sendCommand('worker_details', { itemType: type, id });
}

/**
 * Execute arbitrary CDP method via the daemon's worker.
 */
export async function callCDP(
  method: string,
  params?: Record<string, unknown>
): Promise<ClientResponse<'cdp_call'>> {
  return sendCommand('cdp_call', { method, ...(params && { params }) });
}
