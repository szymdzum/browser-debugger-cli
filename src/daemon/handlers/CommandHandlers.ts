/**
 * Command Handlers
 *
 * Handles generic CDP command forwarding and handshake.
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import { getErrorMessage } from '@/connection/errors.js';
import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import {
  type ClientRequestUnion,
  type ClientResponse,
  type CommandName,
  type HandshakeRequest,
  type HandshakeResponse,
  type WorkerRequest,
  type WorkerRequestUnion,
} from '@/ipc/index.js';
import { generateRequestId } from '@/ipc/utils/requestId.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Handles handshake and generic command forwarding.
 */
export class CommandHandlers {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly pendingRequests: PendingRequestManager,
    private readonly sendResponse: SendResponseFn
  ) {}

  /**
   * Handle handshake request.
   */
  handleHandshake(socket: Socket, request: HandshakeRequest): void {
    console.error(`[daemon] Handshake request received (sessionId: ${request.sessionId})`);

    const response: HandshakeResponse = {
      type: 'handshake_response',
      sessionId: request.sessionId,
      status: 'ok',
      message: 'Handshake successful',
    };

    this.sendResponse(socket, response);
    console.error('[daemon] Handshake response sent');
  }

  /**
   * Generic handler for all command requests (CDP commands).
   */
  handleCommand(socket: Socket, request: ClientRequestUnion): void {
    const commandName = request.type.replace('_request', '') as CommandName;

    console.error(`[daemon] ${commandName} request received (sessionId: ${request.sessionId})`);

    if (!this.workerManager.hasActiveWorker()) {
      const response = {
        type: `${commandName}_response` as const,
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker process',
      };
      this.sendResponse(socket, response);
      console.error(`[daemon] ${commandName} error response sent (no worker)`);
      return;
    }

    const requestId = generateRequestId(commandName);

    const timeout = setTimeout(() => {
      this.pendingRequests.remove(requestId);
      const response = {
        type: `${commandName}_response` as const,
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (10s)',
      };
      this.sendResponse(socket, response);
      console.error(`[daemon] ${commandName} timeout response sent`);
    }, 10000);

    this.pendingRequests.add(requestId, {
      socket,
      sessionId: request.sessionId,
      timeout,
      commandName,
    });

    // Extract only sessionId, keep all other fields including 'type' param if it exists
    const { sessionId: _sessionId, type: _ipcType, ...params } = request;
    const workerRequest: WorkerRequest<typeof commandName> = {
      type: `${commandName}_request` as const,
      requestId,
      ...params,
    } as WorkerRequest<typeof commandName>;

    try {
      this.workerManager.send(workerRequest as WorkerRequestUnion);
      console.error(
        `[daemon] Forwarded ${commandName}_request to worker (requestId: ${requestId})`
      );
    } catch (error) {
      this.pendingRequests.remove(requestId);
      const response = {
        type: `${commandName}_response` as const,
        sessionId: request.sessionId,
        status: 'error',
        error: getErrorMessage(error),
      } satisfies ClientResponse<typeof commandName>;
      this.sendResponse(socket, response);
      console.error(
        `[daemon] Failed to forward ${commandName}_request to worker: ${getErrorMessage(error)}`
      );
    }
  }
}
