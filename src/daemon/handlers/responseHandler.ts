/**
 * Response Handler
 *
 * Handles responses from worker process and forwards them to CLI clients.
 * Manages worker exit scenarios and transforms worker responses to client format.
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import type { WorkerIPCResponse } from '@/daemon/workerIpc.js';
import {
  type ClientResponse,
  type CommandName,
  type PeekResponse,
  type StatusResponse,
  type StatusResponseData,
  type WorkerResponse,
  type WorkerResponseUnion,
  getCommandName,
  isCommandResponse,
} from '@/ipc/index.js';
import { readPid } from '@/session/pid.js';

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Handles worker responses and exit events.
 */
export class ResponseHandler {
  constructor(
    private readonly pendingRequests: PendingRequestManager,
    private readonly sendResponse: SendResponseFn
  ) {}

  /**
   * Handle response from worker (lifecycle signals or command responses).
   */
  handleWorkerResponse(message: WorkerIPCResponse | WorkerResponseUnion): void {
    console.error(
      `[daemon] Received worker response: ${message.type} (requestId: ${message.requestId})`
    );

    // Check for ready signal (not a command response)
    if (message.type === 'worker_ready') {
      console.error('[daemon] Worker ready signal (already processed during launch)');
      return;
    }

    // Check if this is a command response
    if (isCommandResponse(message.type)) {
      // Look up pending request
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) {
        console.error(`[daemon] No pending request found for requestId: ${message.requestId}`);
        return;
      }

      // Remove from pending (includes clearing timeout)
      this.pendingRequests.remove(message.requestId);

      // Forward response to client
      this.forwardCommandResponse(pending.socket, pending.sessionId, message, pending);
    }
  }

  /**
   * Handle worker exit event.
   */
  handleWorkerExit(code: number | null, signal: NodeJS.Signals | null): void {
    console.error(
      `[daemon] Worker exit detected (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
    );

    if (this.pendingRequests.size === 0) {
      return;
    }

    const errorMessage = 'Worker process exited before responding';

    for (const [requestId, pending] of this.pendingRequests.getAll()) {
      this.pendingRequests.remove(requestId);

      if (pending.commandName === 'worker_status') {
        const statusResponse: StatusResponse = {
          type: 'status_response',
          sessionId: pending.sessionId,
          status: 'error',
          ...(pending.statusData && { data: pending.statusData }),
          error: errorMessage,
        };
        this.sendResponse(pending.socket, statusResponse);
        continue;
      }

      if (pending.commandName === 'worker_peek') {
        const peekResponse: PeekResponse = {
          type: 'peek_response',
          sessionId: pending.sessionId,
          status: 'error',
          error: errorMessage,
        };
        this.sendResponse(pending.socket, peekResponse);
        continue;
      }

      if (pending.commandName) {
        const response = {
          type: `${pending.commandName}_response` as const,
          sessionId: pending.sessionId,
          status: 'error',
          error: errorMessage,
        } satisfies ClientResponse<CommandName>;
        this.sendResponse(pending.socket, response);
        continue;
      }

      const fallback: StatusResponse = {
        type: 'status_response',
        sessionId: pending.sessionId,
        status: 'error',
        error: errorMessage,
      };
      this.sendResponse(pending.socket, fallback);
    }
  }

  /**
   * Generic forwarder for all command responses.
   */
  private forwardCommandResponse(
    socket: Socket,
    sessionId: string,
    workerResponse: WorkerResponseUnion,
    pendingRequest?: { statusData?: StatusResponseData; commandName?: CommandName }
  ): void {
    const commandName = getCommandName(workerResponse.type);
    if (!commandName) {
      console.error(`[daemon] Invalid worker response type: ${workerResponse.type}`);
      return;
    }

    // Special handling for worker_status - merge with base status data
    if (commandName === 'worker_status') {
      this.forwardWorkerStatusResponse(
        socket,
        sessionId,
        workerResponse as WorkerResponse<'worker_status'>,
        pendingRequest
      );
      return;
    }

    // Special handling for worker_peek - transform to PeekResponse format
    if (commandName === 'worker_peek') {
      const {
        requestId: _requestId,
        success,
        data,
        error,
      } = workerResponse as WorkerResponse<'worker_peek'>;
      const peekResponse: PeekResponse = {
        type: 'peek_response',
        sessionId,
        status: success ? 'ok' : 'error',
        ...(success &&
          data && {
            data: {
              sessionPid: readPid() ?? 0,
              preview: {
                version: data.version,
                success: true,
                timestamp: new Date(data.startTime).toISOString(),
                duration: data.duration,
                target: data.target,
                data: {
                  network: data.network,
                  console: data.console,
                },
                partial: true,
              },
            },
          }),
        ...(error && { error }),
      };
      this.sendResponse(socket, peekResponse);
      console.error(
        '[daemon] Forwarded worker_peek_response to client (transformed to PeekResponse)'
      );
      return;
    }

    // Default handling for other commands
    const { requestId: _requestId, success, ...rest } = workerResponse;

    const response: ClientResponse<typeof commandName> = {
      ...rest,
      type: `${commandName}_response` as const,
      sessionId,
      status: success ? 'ok' : 'error',
    } as ClientResponse<typeof commandName>;

    this.sendResponse(socket, response);
    console.error(`[daemon] Forwarded ${commandName}_response to client`);
  }

  /**
   * Forward worker status response with enriched activity data.
   */
  private forwardWorkerStatusResponse(
    socket: Socket,
    sessionId: string,
    workerResponse: WorkerResponse<'worker_status'>,
    pendingRequest?: { statusData?: StatusResponseData }
  ): void {
    const { success, data, error } = workerResponse;
    const baseStatusData = pendingRequest?.statusData;

    if (success && data && baseStatusData) {
      const enrichedData: StatusResponseData = {
        ...baseStatusData,
        activity: data.activity,
        pageState: data.target,
      };

      const statusResponse: StatusResponse = {
        type: 'status_response',
        sessionId,
        status: 'ok',
        data: enrichedData,
      };

      this.sendResponse(socket, statusResponse);
      console.error(
        '[daemon] Forwarded worker_status_response to client (enriched with activity data)'
      );
      return;
    }

    if (baseStatusData) {
      const statusResponse: StatusResponse = {
        type: 'status_response',
        sessionId,
        status: error ? 'error' : 'ok',
        data: baseStatusData,
        ...(error && { error }),
      };

      this.sendResponse(socket, statusResponse);
      console.error(
        '[daemon] Forwarded status_response to client (worker query failed, using base data only)'
      );
      return;
    }

    const fallback: StatusResponse = {
      type: 'status_response',
      sessionId,
      status: 'error',
      error: error ?? 'Failed to retrieve status data',
    };

    this.sendResponse(socket, fallback);
    console.error('[daemon] Forwarded status_response error (no base data available)');
  }
}
