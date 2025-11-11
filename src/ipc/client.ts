/* eslint-disable import/order */
/**
 * IPC Client - Minimal JSONL handshake MVP
 *
 * Connects to the daemon's Unix domain socket and performs handshake.
 */

import { randomUUID } from 'crypto';
import { connect, type Socket } from 'net';

import { getIPCRequestTimeout } from '@/constants.js';
import { getDaemonSocketPath } from '@/session/paths.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { filterDefined } from '@/utils/objects.js';

import {
  type COMMANDS,
  type CommandName,
  type ClientRequest,
  type ClientResponse,
} from '@/ipc/commands.js';
import {
  type HandshakeRequest,
  type HandshakeResponse,
  type PeekRequest,
  type PeekResponse,
  type StartSessionRequest,
  type StartSessionResponse,
  type StatusRequest,
  type StatusResponse,
  type StopSessionRequest,
  type StopSessionResponse,
} from '@/ipc/types.js';
import type { TelemetryType } from '@/types.js';

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
  const socketPath = getDaemonSocketPath();

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
        const fullMessage = [
          `IPC ${requestName} connection error`,
          `Socket: ${socketPath}`,
          `Details: ${err.message}`,
        ].join(' | ');
        reject(new Error(fullMessage));
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
    headless?: boolean;
    chromeWsUrl?: string;
  }
): Promise<StartSessionResponse> {
  const request: StartSessionRequest = {
    type: 'start_session_request',
    sessionId: randomUUID(),
    url,
    ...filterDefined({
      port: options?.port,
      timeout: options?.timeout,
      telemetry: options?.telemetry,
      includeAll: options?.includeAll,
      userDataDir: options?.userDataDir,
      maxBodySize: options?.maxBodySize,
      headless: options?.headless,
      chromeWsUrl: options?.chromeWsUrl,
    }),
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
 * Capture page screenshot via the daemon's worker.
 *
 * @param path - Output file path (absolute path)
 * @param options - Screenshot options (format, quality, fullPage)
 * @returns Screenshot response with metadata (path, dimensions, size)
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function captureScreenshot(
  path: string,
  options?: {
    format?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
  }
): Promise<ClientResponse<'dom_screenshot'>> {
  return sendCommand('dom_screenshot', {
    path,
    ...filterDefined({
      format: options?.format,
      quality: options?.quality,
      fullPage: options?.fullPage,
    }),
  });
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
