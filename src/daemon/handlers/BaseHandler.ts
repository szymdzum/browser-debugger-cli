/**
 * Base Handler
 *
 * Shared functionality for forwarding requests to worker process.
 * Provides consistent error handling, timeouts, and pending request tracking.
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { CommandName, WorkerRequestUnion } from '@/ipc/index.js';
import type { StatusResponseData } from '@/ipc/session/index.js';
import { getErrorMessage } from '@/utils/errors.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Configuration for worker request forwarding.
 */
export interface ForwardToWorkerConfig {
  socket: Socket;
  sessionId: string;
  commandName: string;
  workerRequest: WorkerRequestUnion;
  timeoutMs?: number;
  statusData?: StatusResponseData;
}

/**
 * Base handler with shared worker forwarding logic.
 */
export class BaseHandler {
  protected static readonly DEFAULT_WORKER_TIMEOUT = 5000;

  constructor(
    protected readonly workerManager: WorkerManager,
    protected readonly pendingRequests: PendingRequestManager,
    protected readonly sendResponse: SendResponseFn
  ) {}

  /**
   * Check if worker is available.
   *
   * @returns True if active worker exists
   */
  protected hasActiveWorker(): boolean {
    return this.workerManager.hasActiveWorker();
  }

  /**
   * Send error response when no worker is available.
   *
   * @param socket - Client socket
   * @param sessionId - Session identifier
   * @param commandName - Command name for response type
   * @param errorMessage - Error message (defaults to "No active worker process")
   */
  protected sendNoWorkerResponse(
    socket: Socket,
    sessionId: string,
    commandName: string,
    errorMessage = 'No active worker process'
  ): void {
    const response = {
      type: `${commandName}_response` as const,
      sessionId,
      status: 'error' as const,
      error: errorMessage,
    };
    this.sendResponse(socket, response);
    console.error(`[daemon] ${commandName} error response sent (no worker)`);
  }

  /**
   * Helper to send standardized error responses.
   *
   * @param socket - Client socket
   * @param sessionId - Session identifier
   * @param commandName - Command name for response type
   * @param error - Error message
   * @param statusData - Optional status data to include in response
   */
  private sendErrorResponse(
    socket: Socket,
    sessionId: string,
    commandName: string,
    error: string,
    statusData?: StatusResponseData
  ): void {
    const response = {
      type: `${commandName}_response` as const,
      sessionId,
      status: 'error' as const,
      error,
      ...(statusData && { data: statusData }),
    };
    this.sendResponse(socket, response);
    console.error(`[daemon] ${commandName} error response sent: ${error}`);
  }

  /**
   * Generic worker request forwarder with timeout and error handling.
   *
   * Encapsulates the common pattern of:
   * 1. Setting a timeout
   * 2. Tracking the pending request
   * 3. Sending the message to worker
   * 4. Handling immediate send errors
   *
   * @param config - Forwarding configuration
   */
  protected forwardToWorker(config: ForwardToWorkerConfig): void {
    const { socket, sessionId, commandName, workerRequest, statusData } = config;
    const timeoutMs = config.timeoutMs ?? BaseHandler.DEFAULT_WORKER_TIMEOUT;
    const requestId = workerRequest.requestId;

    const timeout = setTimeout(() => {
      this.pendingRequests.remove(requestId);
      this.sendErrorResponse(
        socket,
        sessionId,
        commandName,
        `Worker response timeout (${timeoutMs / 1000}s)`,
        statusData
      );
    }, timeoutMs);

    this.pendingRequests.add(requestId, {
      socket,
      sessionId,
      timeout,
      commandName: commandName as CommandName,
      ...(statusData && { statusData }),
    });

    try {
      this.workerManager.send(workerRequest);
      console.error(`[daemon] Forwarded ${workerRequest.type} to worker (requestId: ${requestId})`);
    } catch (error) {
      this.pendingRequests.remove(requestId);
      this.sendErrorResponse(socket, sessionId, commandName, getErrorMessage(error), statusData);
    }
  }
}
