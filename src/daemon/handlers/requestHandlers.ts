/**
 * Request Handlers
 *
 * Handles incoming IPC requests from CLI clients.
 * Each handler is responsible for processing one type of request.
 */

import type { PendingRequestManager } from './pendingRequests.js';
import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import { WorkerStartError } from '@/daemon/startSession.js';
import {
  type ClientRequestUnion,
  type CommandName,
  type HandshakeRequest,
  type HandshakeResponse,
  type PeekRequest,
  type PeekResponse,
  type StartSessionRequest,
  type StartSessionResponse,
  type StartSessionResponseData,
  type StatusRequest,
  type StatusResponse,
  type StatusResponseData,
  type StopSessionRequest,
  type StopSessionResponse,
  type WorkerRequest,
  type WorkerRequestUnion,
  IPCErrorCode,
} from '@/ipc/index.js';
import { generateRequestId } from '@/ipc/utils/requestId.js';
import { cleanupSession } from '@/session/cleanup.js';
import { releaseDaemonLock } from '@/session/lock.js';
import { readSessionMetadata } from '@/session/metadata.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import type { CDPTarget } from '@/types.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('daemon');

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Request handlers for IPC server.
 */
export class RequestHandlers {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly pendingRequests: PendingRequestManager,
    private readonly sendResponse: SendResponseFn,
    private readonly daemonStartTime: number
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
   * Handle status request.
   */
  handleStatusRequest(socket: Socket, request: StatusRequest): void {
    console.error(`[daemon] Status request received (sessionId: ${request.sessionId})`);

    try {
      // Gather daemon metadata
      const data: StatusResponseData = {
        daemonPid: process.pid,
        daemonStartTime: this.daemonStartTime,
        socketPath: getSessionFilePath('DAEMON_SOCKET'),
      };

      // Check for active session
      const sessionPid = readPid();
      if (sessionPid && isProcessAlive(sessionPid)) {
        data.sessionPid = sessionPid;

        // Try to read session metadata
        const metadata = readSessionMetadata({ warnOnCorruption: true });
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
  handlePeekRequest(socket: Socket, request: PeekRequest): void {
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

  /**
   * Handle start session request.
   */
  async handleStartSessionRequest(socket: Socket, request: StartSessionRequest): Promise<void> {
    console.error(
      `[daemon] Start session request received (sessionId: ${request.sessionId}, url: ${request.url})`
    );

    try {
      // Check for existing session (concurrency guard)
      const sessionPid = readPid();
      if (sessionPid && isProcessAlive(sessionPid)) {
        // Read session metadata to provide helpful error context
        const metadata = readSessionMetadata({ warnOnCorruption: false });
        const startTime = metadata?.startTime;
        const duration = startTime ? Math.floor((Date.now() - startTime) / 1000) : undefined;

        // Try to get target URL from CDP
        let targetUrl: string | undefined;
        if (metadata?.port && metadata?.targetId) {
          try {
            const targets = await fetchCDPTargets(metadata.port);
            const target = targets.find((t: CDPTarget) => t.id === metadata.targetId);
            if (target) {
              targetUrl = target.url;
            }
          } catch (error) {
            log.debug(
              `Failed to fetch CDP targets for existing session: ${getErrorMessage(error)}`
            );
          }
        }

        const response: StartSessionResponse = {
          type: 'start_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: `Session already running (PID ${sessionPid}). Stop it first with stop_session_request.`,
          errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
          existingSession: {
            pid: sessionPid,
            ...(targetUrl && { targetUrl }),
            ...(startTime && { startTime }),
            ...(duration !== undefined && { duration }),
          },
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Start session error response sent (session already running)');
        return;
      }

      // Launch worker
      console.error('[daemon] Launching worker...');
      try {
        const metadata = await this.workerManager.launch(
          request.url,
          filterDefined({
            port: request.port,
            timeout: request.timeout,
            telemetry: request.telemetry,
            includeAll: request.includeAll,
            userDataDir: request.userDataDir,
            maxBodySize: request.maxBodySize,
            headless: request.headless,
            chromeWsUrl: request.chromeWsUrl,
          })
        );

        console.error('[daemon] Worker launched successfully');

        // Build response data
        const data: StartSessionResponseData = {
          workerPid: metadata.workerPid,
          chromePid: metadata.chromePid,
          port: metadata.port,
          targetUrl: metadata.targetUrl,
          ...(metadata.targetTitle !== undefined && { targetTitle: metadata.targetTitle }),
        };

        const response: StartSessionResponse = {
          type: 'start_session_response',
          sessionId: request.sessionId,
          status: 'ok',
          data,
          message: 'Session started successfully',
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Start session response sent');
      } catch (error) {
        // Map worker errors to IPC error codes
        let errorCode: IPCErrorCode = IPCErrorCode.WORKER_START_FAILED;
        let errorMessage = 'Failed to start worker';

        if (error instanceof WorkerStartError) {
          // Include error details (contains worker stderr) for debugging
          errorMessage = error.details ? `${error.message}\n${error.details}` : error.message;
          switch (error.code) {
            case 'SPAWN_FAILED':
            case 'WORKER_CRASH':
            case 'INVALID_READY_MESSAGE':
              errorCode = IPCErrorCode.WORKER_START_FAILED;
              break;
            case 'READY_TIMEOUT':
              errorCode = IPCErrorCode.CDP_TIMEOUT;
              break;
          }
        } else {
          errorMessage = getErrorMessage(error);
        }

        const response: StartSessionResponse = {
          type: 'start_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: errorMessage,
          errorCode,
        };

        this.sendResponse(socket, response);
        console.error(`[daemon] Start session error response sent (${errorCode})`);
      }
    } catch (error) {
      const response: StartSessionResponse = {
        type: 'start_session_response',
        sessionId: request.sessionId,
        status: 'error',
        message: `Daemon error: ${getErrorMessage(error)}`,
        errorCode: IPCErrorCode.DAEMON_ERROR,
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Start session error response sent (daemon error)');
    }
  }

  /**
   * Handle stop session request.
   */
  handleStopSessionRequest(socket: Socket, request: StopSessionRequest): void {
    console.error(`[daemon] Stop session request received (sessionId: ${request.sessionId})`);

    try {
      // Check for active session
      const sessionPid = readPid();
      if (!sessionPid || !isProcessAlive(sessionPid)) {
        const response: StopSessionResponse = {
          type: 'stop_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: 'No active session found',
          errorCode: IPCErrorCode.NO_SESSION,
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Stop session error response sent (no session)');
        return;
      }

      // Capture Chrome PID BEFORE cleanup (so CLI can kill Chrome if needed)
      const metadata = readSessionMetadata({ warnOnCorruption: true });
      const chromePid = metadata?.chromePid;
      if (chromePid) {
        console.error(`[daemon] Captured Chrome PID ${chromePid} before cleanup`);
      }

      // Kill the session process (use SIGTERM for graceful shutdown)
      try {
        process.kill(sessionPid, 'SIGTERM');
        console.error(`[daemon] Sent SIGTERM to session process (PID ${sessionPid})`);
      } catch (killError: unknown) {
        const errorMessage = killError instanceof Error ? killError.message : String(killError);
        const response: StopSessionResponse = {
          type: 'stop_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: `Failed to kill session process: ${errorMessage}`,
          errorCode: IPCErrorCode.SESSION_KILL_FAILED,
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Stop session error response sent (kill failed)');
        return;
      }

      // Clean up session files
      cleanupSession();
      console.error('[daemon] Cleaned up session files');

      // Clear worker process reference
      this.workerManager.dispose();
      console.error('[daemon] Cleared worker process reference');

      const response: StopSessionResponse = {
        type: 'stop_session_response',
        sessionId: request.sessionId,
        status: 'ok',
        message: 'Session stopped successfully',
        ...(chromePid !== undefined && { chromePid }),
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Stop session response sent');

      // Release lock immediately so new sessions can start
      releaseDaemonLock();
      console.error('[daemon] Daemon lock released');

      // Shutdown daemon after successful stop
      // Give socket time to flush response, then exit gracefully
      setTimeout(() => {
        console.error('[daemon] Shutting down daemon after successful stop');
        process.exit(0);
      }, 100);
    } catch (error) {
      const response: StopSessionResponse = {
        type: 'stop_session_response',
        sessionId: request.sessionId,
        status: 'error',
        message: `Failed to stop session: ${getErrorMessage(error)}`,
        errorCode: IPCErrorCode.DAEMON_ERROR,
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Stop session error response sent');
    }
  }

  /**
   * Generic handler for all command requests.
   */
  handleCommandRequest(socket: Socket, request: ClientRequestUnion): void {
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
      };
      this.sendResponse(socket, response);
      console.error(
        `[daemon] Failed to forward ${commandName}_request to worker: ${getErrorMessage(error)}`
      );
    }
  }
}
