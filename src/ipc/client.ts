/**
 * IPC Client - Minimal JSONL handshake MVP
 *
 * Connects to the daemon's Unix domain socket and performs handshake.
 */

import { randomUUID } from 'crypto';
import { connect } from 'net';

import type { Socket } from 'net';

import { IPCServer } from '@/daemon/ipcServer.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  IPCRequest,
  IPCResponse,
  PeekRequest,
  PeekResponse,
  StartSessionRequest,
  StartSessionResponse,
  StatusRequest,
  StatusResponse,
  StopSessionRequest,
  StopSessionResponse,
  DomQueryRequest,
  DomQueryResponse,
  DomHighlightRequest,
  DomHighlightResponse,
  DomGetRequest,
  DomGetResponse,
} from '@/ipc/types.js';
import type { CollectorType } from '@/types.js';

/**
 * Generic IPC request sender that handles connection, timeout, and error handling.
 *
 * @param request - The IPC request to send
 * @param requestName - Human-readable name for logging (e.g., 'status', 'peek')
 * @returns Promise that resolves with the response
 */
async function sendRequest<TRequest extends IPCRequest, TResponse extends IPCResponse>(
  request: TRequest,
  requestName: string
): Promise<TResponse> {
  const socketPath = IPCServer.getSocketPath();

  return new Promise((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    let buffer = '';
    let resolved = false;

    // Set request timeout
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`${requestName} request timeout after 5s`));
      }
    }, 5000);

    socket.on('connect', () => {
      console.error(`[client] Connected to daemon for ${requestName} request`);

      socket.write(JSON.stringify(request) + '\n');
      console.error(`[client] ${requestName} request sent`);
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
            console.error(`[client] ${requestName} response received`);

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
                new Error(
                  `Failed to parse ${requestName} response: ${error instanceof Error ? error.message : String(error)}`
                )
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
    collectors?: CollectorType[];
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
    ...(options?.collectors !== undefined && { collectors: options.collectors }),
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
 * Query DOM elements by CSS selector via the daemon's worker.
 *
 * @param selector - CSS selector to query
 * @returns DOM query response with matched elements
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function queryDOM(selector: string): Promise<DomQueryResponse> {
  const request: DomQueryRequest = {
    type: 'dom_query_request',
    sessionId: randomUUID(),
    selector,
  };

  return sendRequest<DomQueryRequest, DomQueryResponse>(request, 'dom query');
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
}): Promise<DomHighlightResponse> {
  const request: DomHighlightRequest = {
    type: 'dom_highlight_request',
    sessionId: randomUUID(),
    ...(options.selector !== undefined && { selector: options.selector }),
    ...(options.index !== undefined && { index: options.index }),
    ...(options.nodeId !== undefined && { nodeId: options.nodeId }),
    ...(options.first !== undefined && { first: options.first }),
    ...(options.nth !== undefined && { nth: options.nth }),
    ...(options.color !== undefined && { color: options.color }),
    ...(options.opacity !== undefined && { opacity: options.opacity }),
  };

  return sendRequest<DomHighlightRequest, DomHighlightResponse>(request, 'dom highlight');
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
}): Promise<DomGetResponse> {
  const request: DomGetRequest = {
    type: 'dom_get_request',
    sessionId: randomUUID(),
    ...(options.selector !== undefined && { selector: options.selector }),
    ...(options.index !== undefined && { index: options.index }),
    ...(options.nodeId !== undefined && { nodeId: options.nodeId }),
    ...(options.all !== undefined && { all: options.all }),
    ...(options.nth !== undefined && { nth: options.nth }),
  };

  return sendRequest<DomGetRequest, DomGetResponse>(request, 'dom get');
}
