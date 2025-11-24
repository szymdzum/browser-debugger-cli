/**
 * Query Handlers
 *
 * Handles query requests: status and peek (read-only operations).
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import { getErrorMessage } from '@/connection/errors.js';
import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { ISessionService } from '@/daemon/services/SessionService.js';
import {
  type HARDataRequest,
  type PeekRequest,
  type StatusRequest,
  type StatusResponse,
  type StatusResponseData,
  type WorkerRequest,
  type WorkerRequestUnion,
} from '@/ipc/index.js';
import { generateRequestId } from '@/ipc/utils/requestId.js';
import { filterDefined } from '@/utils/objects.js';

import { BaseHandler } from './BaseHandler.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Handles status and peek queries.
 */
export class QueryHandlers extends BaseHandler {
  constructor(
    workerManager: WorkerManager,
    pendingRequests: PendingRequestManager,
    sendResponse: SendResponseFn,
    private readonly sessionService: ISessionService,
    private readonly daemonStartTime: number
  ) {
    super(workerManager, pendingRequests, sendResponse);
  }

  /**
   * Handle status request.
   */
  handleStatus(socket: Socket, request: StatusRequest): void {
    console.error(`[daemon] Status request received (sessionId: ${request.sessionId})`);

    try {
      const data: StatusResponseData = {
        daemonPid: process.pid,
        daemonStartTime: this.daemonStartTime,
        socketPath: this.sessionService.getFilePath('DAEMON_SOCKET'),
      };

      const sessionPid = this.sessionService.readPid();
      if (sessionPid && this.sessionService.isProcessAlive(sessionPid)) {
        data.sessionPid = sessionPid;

        const metadata = this.sessionService.readMetadata({ warnOnCorruption: true });
        if (metadata) {
          data.sessionMetadata = filterDefined({
            bdgPid: metadata.bdgPid,
            chromePid: metadata.chromePid,
            startTime: metadata.startTime,
            port: metadata.port,
            targetId: metadata.targetId,
            webSocketDebuggerUrl: metadata.webSocketDebuggerUrl,
            activeTelemetry: metadata.activeTelemetry,
          }) as Required<NonNullable<StatusResponseData['sessionMetadata']>>;
        }

        if (this.hasActiveWorker()) {
          const workerRequest: WorkerRequest<'worker_status'> = {
            type: 'worker_status_request',
            requestId: generateRequestId('worker_status'),
          };

          this.forwardToWorker({
            socket,
            sessionId: request.sessionId,
            commandName: 'worker_status',
            workerRequest: workerRequest as WorkerRequestUnion,
            statusData: data,
          });
          return; // Will send response when worker responds
        }
      }

      const response: StatusResponse = {
        type: 'status_response',
        sessionId: request.sessionId,
        status: 'ok',
        data,
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Status response sent');
    } catch (error) {
      const response: StatusResponse = {
        type: 'status_response',
        sessionId: request.sessionId,
        status: 'error',
        error: `Failed to gather status: ${getErrorMessage(error)}`,
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Status error response sent');
    }
  }

  /**
   * Handle HAR data request - forward to worker via IPC.
   */
  handleHARData(socket: Socket, request: HARDataRequest): void {
    console.error(`[daemon] HAR data request received (sessionId: ${request.sessionId})`);

    if (!this.hasActiveWorker()) {
      this.sendNoWorkerResponse(socket, request.sessionId, 'har_data', 'No active session');
      return;
    }

    const workerRequest: WorkerRequest<'worker_har_data'> = {
      type: 'worker_har_data_request',
      requestId: generateRequestId('worker_har_data'),
    };

    this.forwardToWorker({
      socket,
      sessionId: request.sessionId,
      commandName: 'worker_har_data',
      workerRequest: workerRequest as WorkerRequestUnion,
    });
  }

  /**
   * Handle peek request - forward to worker via IPC.
   */
  handlePeek(socket: Socket, request: PeekRequest): void {
    console.error(`[daemon] Peek request received (sessionId: ${request.sessionId})`);

    if (!this.hasActiveWorker()) {
      this.sendNoWorkerResponse(socket, request.sessionId, 'peek', 'No active session');
      return;
    }

    // Use client's lastN if provided, otherwise default to 10 for preview
    const lastN = request.lastN ?? 10;

    const workerRequest: WorkerRequest<'worker_peek'> = {
      type: 'worker_peek_request',
      requestId: generateRequestId('worker_peek'),
      lastN,
    };

    this.forwardToWorker({
      socket,
      sessionId: request.sessionId,
      commandName: 'worker_peek',
      workerRequest: workerRequest as WorkerRequestUnion,
    });
  }
}
