/**
 * Command Handlers
 *
 * Handles generic CDP command forwarding and handshake.
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import {
  type ClientRequestUnion,
  type CommandName,
  type HandshakeRequest,
  type HandshakeResponse,
  type WorkerRequest,
  type WorkerRequestUnion,
} from '@/ipc/index.js';
import { generateRequestId } from '@/ipc/utils/requestId.js';

import { BaseHandler } from './BaseHandler.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Handles handshake and generic command forwarding.
 */
export class CommandHandlers extends BaseHandler {
  private static readonly COMMAND_TIMEOUT = 10000;

  constructor(
    workerManager: WorkerManager,
    pendingRequests: PendingRequestManager,
    sendResponse: SendResponseFn
  ) {
    super(workerManager, pendingRequests, sendResponse);
  }

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

    if (!this.hasActiveWorker()) {
      this.sendNoWorkerResponse(socket, request.sessionId, commandName);
      return;
    }

    const { sessionId: _sessionId, type: _ipcType, ...params } = request;
    const workerRequest: WorkerRequest<typeof commandName> = {
      type: `${commandName}_request` as const,
      requestId: generateRequestId(commandName),
      ...params,
    } as WorkerRequest<typeof commandName>;

    this.forwardToWorker({
      socket,
      sessionId: request.sessionId,
      commandName,
      workerRequest: workerRequest as WorkerRequestUnion,
      timeoutMs: CommandHandlers.COMMAND_TIMEOUT,
    });
  }
}
