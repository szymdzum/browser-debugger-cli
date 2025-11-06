/**
 * IPC Client - Minimal JSONL handshake MVP
 *
 * Connects to the daemon's Unix domain socket and performs handshake.
 */

import { randomUUID } from 'crypto';
import { connect } from 'net';

import type { Socket } from 'net';

import { getIPCRequestTimeout } from '@/constants.js';
import { IPCServer } from '@/daemon/ipcServer.js';
import type { COMMANDS } from '@/ipc/commands.js';
import { type CommandName, type ClientRequest, type ClientResponse } from '@/ipc/commands.js';
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
} from '@/ipc/types.js';
import type { TelemetryType } from '@/types.js';
import { getErrorMessage } from '@/utils/errors.js';
import { createLogger } from '@/utils/logger.js';

const log = createLogger('client');

/**
 * Generic IPC request sender that handles connection, timeout, and error handling.
 * Supports both traditional IPC messages (handshake, status, etc.) and command messages (DOM commands).
 *
 * @param request - The IPC request to send (either IPCRequest or ClientRequest<T>)
 * @param requestName - Human-readable name for logging (e.g., 'status', 'peek')
 * @returns Promise that resolves with the response
 */
async function sendRequest<TRequest, TResponse>(
  request: TRequest,
  requestName: string
): Promise<TResponse> {
  const socketPath = IPCServer.getSocketPath();

  return new Promise((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    let buffer = '';
    let resolved = false;

    // Set request timeout
    const timeoutMs = getIPCRequestTimeout();
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`${requestName} request timeout after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    socket.on('connect', () => {
      log.debug(`Connected to daemon for ${requestName} request`);

      socket.write(JSON.stringify(request) + '\n');
      log.debug(`${requestName} request sent`);
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Process complete JSONL frames
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim() && !resolved) {
          try {
            const response = JSON.parse(line) as TResponse;
            log.debug(`${requestName} response received`);

            resolved = true;
            clearTimeout(timeout);
            socket.destroy();
            resolve(response);
          } catch (error) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              reject(
                new Error(`Failed to parse ${requestName} response: ${getErrorMessage(error)}`)
              );
            }
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${err.message}`));
      }
    });

    socket.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Connection closed before ${requestName} response received`));
      }
    });
  });
}

/**
 * Connect to the daemon and perform handshake.
 *
 * @returns Handshake response from daemon
 * @throws Error if connection fails or handshake times out
 */
export async function connectToDaemon(): Promise<HandshakeResponse> {
  const request: HandshakeRequest = {
    type: 'handshake_request',
    sessionId: randomUUID(),
  };

  return sendRequest<HandshakeRequest, HandshakeResponse>(request, 'handshake');
}

/**
 * Request status information from the daemon.
 *
 * @returns Status response with daemon and session metadata
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function getStatus(): Promise<StatusResponse> {
  const request: StatusRequest = {
    type: 'status_request',
    sessionId: randomUUID(),
  };

  return sendRequest<StatusRequest, StatusResponse>(request, 'status');
}

/**
 * Request preview data from the daemon.
 *
 * @returns Peek response with session preview data
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function getPeek(): Promise<PeekResponse> {
  const request: PeekRequest = {
    type: 'peek_request',
    sessionId: randomUUID(),
  };

  return sendRequest<PeekRequest, PeekResponse>(request, 'peek');
}

/**
 * Request daemon to start a new browser session.
 *
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @returns Start session response with worker and Chrome metadata
 * @throws Error if connection fails, daemon is not running, or request times out
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
  }
): Promise<StartSessionResponse> {
  const request: StartSessionRequest = {
    type: 'start_session_request',
    sessionId: randomUUID(),
    url,
    ...(options?.port !== undefined && { port: options.port }),
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.telemetry !== undefined && { telemetry: options.telemetry }),
    ...(options?.includeAll !== undefined && { includeAll: options.includeAll }),
    ...(options?.userDataDir !== undefined && { userDataDir: options.userDataDir }),
    ...(options?.maxBodySize !== undefined && { maxBodySize: options.maxBodySize }),
  };

  return sendRequest<StartSessionRequest, StartSessionResponse>(request, 'start session');
}

/**
 * Request session stop from the daemon.
 *
 * @returns Stop session response with success/error status
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function stopSession(): Promise<StopSessionResponse> {
  const request: StopSessionRequest = {
    type: 'stop_session_request',
    sessionId: randomUUID(),
  };

  return sendRequest<StopSessionRequest, StopSessionResponse>(request, 'stop session');
}

/**
 * Generic command sender - works for any registered command in the COMMANDS registry.
 *
 * @param commandName - Name of the command from the COMMANDS registry
 * @param params - Command parameters matching the command's request schema
 * @returns Promise that resolves with the command response
 */
async function sendCommand<T extends CommandName>(
  commandName: T,
  params: (typeof COMMANDS)[T]['requestSchema']
): Promise<ClientResponse<T>> {
  const request: ClientRequest<T> = {
    type: `${commandName}_request` as const,
    sessionId: randomUUID(),
    ...params,
  } as ClientRequest<T>;

  return sendRequest<ClientRequest<T>, ClientResponse<T>>(request, commandName);
}

/**
 * Query DOM elements by CSS selector via the daemon's worker.
 *
 * @param selector - CSS selector to query
 * @returns DOM query response with matched elements
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function queryDOM(selector: string): Promise<ClientResponse<'dom_query'>> {
  return sendCommand('dom_query', { selector });
}

/**
 * Highlight DOM elements in the browser via the daemon's worker.
 *
 * @param options - Highlight options (selector, index, nodeId, color, etc.)
 * @returns DOM highlight response with highlighted node information
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function highlightDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
  first?: boolean;
  nth?: number;
  color?: string;
  opacity?: number;
}): Promise<ClientResponse<'dom_highlight'>> {
  return sendCommand('dom_highlight', options);
}

/**
 * Get full HTML and attributes for DOM elements via the daemon's worker.
 *
 * @param options - Get options (selector, index, nodeId, all, nth)
 * @returns DOM get response with node information
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function getDOM(options: {
  selector?: string;
  index?: number;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}): Promise<ClientResponse<'dom_get'>> {
  return sendCommand('dom_get', options);
}

/**
 * Get details for a specific network request or console message via the daemon's worker.
 *
 * @param type - Type of item: 'network' or 'console'
 * @param id - Request ID for network, index for console
 * @returns Worker details response with full object (including bodies/args)
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function getDetails(
  type: 'network' | 'console',
  id: string
): Promise<ClientResponse<'worker_details'>> {
  return sendCommand('worker_details', { itemType: type, id });
}

/**
 * Execute arbitrary CDP method via the daemon's worker.
 *
 * @param method - CDP method name (e.g., 'Network.getCookies', 'Runtime.evaluate')
 * @param params - CDP method parameters (optional)
 * @returns CDP call response with method result
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function callCDP(
  method: string,
  params?: Record<string, unknown>
): Promise<ClientResponse<'cdp_call'>> {
  return sendCommand('cdp_call', { method, ...(params && { params }) });
}
