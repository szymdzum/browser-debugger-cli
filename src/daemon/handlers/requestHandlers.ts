/**
 * Request Handlers (Facade)
 *
 * Coordinates specialized handler classes for different request types.
 * Delegates to SessionHandlers, QueryHandlers, and CommandHandlers.
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { ISessionService } from '@/daemon/services/SessionService.js';
import {
  type ClientRequestUnion,
  type HandshakeRequest,
  type PeekRequest,
  type StartSessionRequest,
  type StatusRequest,
  type StopSessionRequest,
} from '@/ipc/index.js';

import { CommandHandlers } from './CommandHandlers.js';
import { QueryHandlers } from './QueryHandlers.js';
import { SessionHandlers } from './SessionHandlers.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Facade for all request handlers.
 * Delegates to specialized handler classes.
 */
export class RequestHandlers {
  private readonly sessionHandlers: SessionHandlers;
  private readonly queryHandlers: QueryHandlers;
  private readonly commandHandlers: CommandHandlers;

  constructor(
    workerManager: WorkerManager,
    pendingRequests: PendingRequestManager,
    sessionService: ISessionService,
    sendResponse: SendResponseFn,
    daemonStartTime: number
  ) {
    // Initialize specialized handlers
    this.sessionHandlers = new SessionHandlers(workerManager, sessionService, sendResponse);

    this.queryHandlers = new QueryHandlers(
      workerManager,
      pendingRequests,
      sessionService,
      sendResponse,
      daemonStartTime
    );

    this.commandHandlers = new CommandHandlers(workerManager, pendingRequests, sendResponse);
  }

  /**
   * Handle handshake request.
   */
  handleHandshake(socket: Socket, request: HandshakeRequest): void {
    this.commandHandlers.handleHandshake(socket, request);
  }

  /**
   * Handle status request.
   */
  handleStatusRequest(socket: Socket, request: StatusRequest): void {
    this.queryHandlers.handleStatus(socket, request);
  }

  /**
   * Handle peek request.
   */
  handlePeekRequest(socket: Socket, request: PeekRequest): void {
    this.queryHandlers.handlePeek(socket, request);
  }

  /**
   * Handle start session request.
   */
  async handleStartSessionRequest(socket: Socket, request: StartSessionRequest): Promise<void> {
    await this.sessionHandlers.handleStartSession(socket, request);
  }

  /**
   * Handle stop session request.
   */
  handleStopSessionRequest(socket: Socket, request: StopSessionRequest): void {
    this.sessionHandlers.handleStopSession(socket, request);
  }

  /**
   * Handle generic command request.
   */
  handleCommandRequest(socket: Socket, request: ClientRequestUnion): void {
    this.commandHandlers.handleCommand(socket, request);
  }
}
