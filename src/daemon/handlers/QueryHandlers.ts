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
  type PeekRequest,
  type PeekResponse,
  type StatusRequest,
  type StatusResponse,
  type StatusResponseData,
  type WorkerRequest,
  type WorkerRequestUnion,
} from '@/ipc/index.js';
import { generateRequestId } from '@/ipc/utils/requestId.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Handles status and peek queries.
 */
export class QueryHandlers {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly pendingRequests: PendingRequestManager,
    private readonly sessionService: ISessionService,
    private readonly sendResponse: SendResponseFn,
    private readonly daemonStartTime: number
  ) {}

  /**
   * Handle status request.
   */
  handleStatus(socket: Socket, request: StatusRequest): void {
    console.error(`[daemon] Status request received (sessionId: ${request.sessionId})`);

    try {
      // Gather daemon metadata
      const data: StatusResponseData = {
        daemonPid: process.pid,
        daemonStartTime: this.daemonStartTime,
        socketPath: this.sessionService.getFilePath('DAEMON_SOCKET'),
      };

      // Check for active session
      const sessionPid = this.sessionService.readPid();
      if (sessionPid && this.sessionService.isProcessAlive(sessionPid)) {
        data.sessionPid = sessionPid;

        // Try to read session metadata
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

        // Query worker for live activity data if worker is available
        if (this.workerManager.hasActiveWorker()) {
          const requestId = generateRequestId('worker_status');

          // Set timeout for worker response
          const timeout = setTimeout(() => {
            this.pendingRequests.remove(requestId);
            // Send response without activity data if worker times out
            const response: StatusResponse = {
              type: 'status_response',
              sessionId: request.sessionId,
              status: 'ok',
              data,
            };
            this.sendResponse(socket, response);
            console.error('[daemon] Status response sent (worker timeout)');
          }, 5000);

          // Track pending request with special handling for status
          this.pendingRequests.add(requestId, {
            socket,
            sessionId: request.sessionId,
            timeout,
            statusData: data, // Store base status data
            commandName: 'worker_status',
          });

          // Forward to worker
          const workerRequest: WorkerRequest<'worker_status'> = {
            type: 'worker_status_request',
            requestId,
          };

          try {
            this.workerManager.send(workerRequest as WorkerRequestUnion);
            console.error(
              `[daemon] Forwarded worker_status_request to worker (requestId: ${requestId})`
            );
            return; // Will send response when worker responds
          } catch (error) {
            this.pendingRequests.remove(requestId);
            console.error(
              `[daemon] Failed to forward worker_status_request: ${getErrorMessage(error)}`
            );
          }
        }
      }

      // Send response immediately if no worker
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
   * Handle peek request - forward to worker via IPC.
   */
  handlePeek(socket: Socket, request: PeekRequest): void {
    console.error(`[daemon] Peek request received (sessionId: ${request.sessionId})`);

    // Check for active worker process
    if (!this.workerManager.hasActiveWorker()) {
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active session',
      };
      this.sendResponse(socket, response);
      console.error('[daemon] Peek error response sent (no worker)');
      return;
    }

    // Generate unique request ID
    const requestId = generateRequestId('worker_peek');

    // Set timeout for worker response
    const timeout = setTimeout(() => {
      this.pendingRequests.remove(requestId);
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (5s)',
      };
      this.sendResponse(socket, response);
      console.error('[daemon] Peek timeout response sent');
    }, 5000);

    // Track pending request
    this.pendingRequests.add(requestId, {
      socket,
      sessionId: request.sessionId,
      timeout,
      commandName: 'worker_peek',
    });

    // Forward to worker
    const workerRequest: WorkerRequest<'worker_peek'> = {
      type: 'worker_peek_request',
      requestId,
      lastN: 10, // Default limit for preview items (PeekRequest doesn't include lastN)
    };

    try {
      this.workerManager.send(workerRequest as WorkerRequestUnion);
      console.error(`[daemon] Forwarded worker_peek_request to worker (requestId: ${requestId})`);
    } catch (error) {
      this.pendingRequests.remove(requestId);
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: getErrorMessage(error),
      };
      this.sendResponse(socket, response);
      console.error(`[daemon] Failed to forward worker_peek_request: ${getErrorMessage(error)}`);
    }
  }
}
