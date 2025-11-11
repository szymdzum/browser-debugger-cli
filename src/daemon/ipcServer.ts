/**
 * Daemon IPC Server - Minimal JSONL handshake MVP
 *
 * Starts a Unix domain socket server that:
 * 1. Listens for JSONL frames (newline-delimited JSON messages)
 * 2. Responds only to handshake requests
 * 3. Logs all incoming frames for debugging
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';

import type { Socket } from 'net';

import { SocketServer } from '@/daemon/server/SocketServer.js';
import { WorkerManager } from '@/daemon/server/WorkerManager.js';
import { WorkerStartError } from '@/daemon/startSession.js';
import type { WorkerIPCResponse } from '@/daemon/workerIpc.js';
import {
  type ClientRequestUnion,
  type ClientResponse,
  type CommandName,
  type WorkerRequest,
  type WorkerRequestUnion,
  type WorkerResponse,
  type WorkerResponseUnion,
  getCommandName,
  isCommandRequest,
  isCommandResponse,
} from '@/ipc/commands.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  IPCMessageType,
  PeekRequest,
  PeekResponse,
  StartSessionRequest,
  StartSessionResponse,
  StartSessionResponseData,
  StatusRequest,
  StatusResponse,
  StatusResponseData,
  StopSessionRequest,
  StopSessionResponse,
} from '@/ipc/types.js';
import { IPCErrorCode } from '@/ipc/types.js';
import { cleanupSession } from '@/session/cleanup.js';
import { releaseDaemonLock } from '@/session/lock.js';
import { readSessionMetadata } from '@/session/metadata.js';
import { ensureSessionDir, getSessionFilePath, getDaemonSocketPath } from '@/session/paths.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import type { CDPTarget } from '@/types.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Pending DOM request waiting for worker response
 */
interface PendingDomRequest {
  socket: Socket;
  sessionId: string;
  timeout: NodeJS.Timeout;
  /** Base status data (only for status requests) */
  statusData?: StatusResponseData;
  commandName?: CommandName;
}

/**
 * Simple JSONL IPC server for daemon communication.
 */
export class IPCServer {
  private readonly startTime: number = Date.now();
  private readonly socketServer = new SocketServer();
  private readonly workerManager = new WorkerManager();
  private pendingDomRequests: Map<string, PendingDomRequest> = new Map(); // requestId -> pending request

  constructor() {
    this.workerManager.on('message', (message) => this.handleWorkerResponse(message));
    this.workerManager.on('exit', (code, signal) => this.handleWorkerExit(code, signal));
  }

  /**
   * Start the IPC server on Unix domain socket.
   */
  async start(): Promise<void> {
    // Ensure ~/.bdg directory exists
    ensureSessionDir();

    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    await this.socketServer.start(socketPath, (socket) => this.handleConnection(socket));
    this.writePidFile();
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: Socket): void {
    console.error('[daemon] Client connected');

    let buffer = '';

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Process complete JSONL frames (separated by newlines)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(socket, line);
        }
      }
    });

    socket.on('end', () => {
      console.error('[daemon] Client disconnected');
    });

    socket.on('error', (err) => {
      console.error('[daemon] Socket error:', err);
    });
  }

  /**
   * Handle incoming JSONL message.
   */
  private handleMessage(socket: Socket, line: string): void {
    console.error('[daemon] Raw frame:', line);

    try {
      // Parse message - could be either IPC message or command request
      const message = JSON.parse(line) as IPCMessageType | ClientRequestUnion;

      // Check if this is a command request
      if (isCommandRequest(message.type)) {
        this.handleCommandRequest(socket, message as ClientRequestUnion);
        return;
      }

      switch (message.type) {
        case 'handshake_request':
          this.handleHandshake(socket, message);
          break;
        case 'handshake_response':
          // Response messages are sent by daemon, not received
          console.error('[daemon] Unexpected handshake response from client');
          break;
        case 'status_request':
          this.handleStatusRequest(socket, message);
          break;
        case 'status_response':
          // Response messages are sent by daemon, not received
          console.error('[daemon] Unexpected status response from client');
          break;
        case 'peek_request':
          this.handlePeekRequest(socket, message);
          break;
        case 'peek_response':
          // Response messages are sent by daemon, not received
          console.error('[daemon] Unexpected peek response from client');
          break;
        case 'start_session_request':
          void this.handleStartSessionRequest(socket, message);
          break;
        case 'start_session_response':
          // Response messages are sent by daemon, not received
          console.error('[daemon] Unexpected start session response from client');
          break;
        case 'stop_session_request':
          this.handleStopSessionRequest(socket, message);
          break;
        case 'stop_session_response':
          // Response messages are sent by daemon, not received
          console.error('[daemon] Unexpected stop session response from client');
          break;
        // NOTE: DOM command responses are now handled via command system (see commands.ts)
      }
    } catch (error) {
      console.error('[daemon] Failed to parse message:', error);
    }
  }

  /**
   * Handle handshake request.
   */
  private handleHandshake(socket: Socket, request: HandshakeRequest): void {
    console.error(`[daemon] Handshake request received (sessionId: ${request.sessionId})`);

    const response: HandshakeResponse = {
      type: 'handshake_response',
      sessionId: request.sessionId,
      status: 'ok',
      message: 'Handshake successful',
    };

    // Send JSONL response (JSON + newline)
    socket.write(JSON.stringify(response) + '\n');
    console.error('[daemon] Handshake response sent');
  }

  /**
   * Handle status request.
   */
  private handleStatusRequest(socket: Socket, request: StatusRequest): void {
    console.error(`[daemon] Status request received (sessionId: ${request.sessionId})`);

    try {
      // Gather daemon metadata
      const data: StatusResponseData = {
        daemonPid: process.pid,
        daemonStartTime: this.startTime,
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
          const requestId = `worker_status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // Set timeout for worker response
          const timeout = setTimeout(() => {
            this.pendingDomRequests.delete(requestId);
            // Send response without activity data if worker times out
            const response: StatusResponse = {
              type: 'status_response',
              sessionId: request.sessionId,
              status: 'ok',
              data,
            };
            socket.write(JSON.stringify(response) + '\n');
            console.error('[daemon] Status response sent (worker timeout)');
          }, 5000);

          // Track pending request with special handling for status
          this.pendingDomRequests.set(requestId, {
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
            clearTimeout(timeout);
            this.pendingDomRequests.delete(requestId);
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

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Status response sent');
    } catch (error) {
      const response: StatusResponse = {
        type: 'status_response',
        sessionId: request.sessionId,
        status: 'error',
        error: `Failed to gather status: ${getErrorMessage(error)}`,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Status error response sent');
    }
  }

  /**
   * Handle peek request - forward to worker via IPC.
   */
  private handlePeekRequest(socket: Socket, request: PeekRequest): void {
    console.error(`[daemon] Peek request received (sessionId: ${request.sessionId})`);

    // Check for active worker process
    if (!this.workerManager.hasActiveWorker()) {
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker process',
      };
      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Peek error response sent (no worker)');
      return;
    }

    // Generate unique request ID
    const requestId = `worker_peek_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set timeout for worker response
    const timeout = setTimeout(() => {
      this.pendingDomRequests.delete(requestId);
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (5s)',
      };
      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Peek timeout response sent');
    }, 5000);

    // Track pending request
    this.pendingDomRequests.set(requestId, {
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
      clearTimeout(timeout);
      this.pendingDomRequests.delete(requestId);
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: getErrorMessage(error),
      };
      socket.write(JSON.stringify(response) + '\n');
      console.error(`[daemon] Failed to forward worker_peek_request: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Handle start session request.
   */
  private async handleStartSessionRequest(
    socket: Socket,
    request: StartSessionRequest
  ): Promise<void> {
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
          } catch {
            // Ignore CDP fetch errors
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

        socket.write(JSON.stringify(response) + '\n');
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

        socket.write(JSON.stringify(response) + '\n');
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

        socket.write(JSON.stringify(response) + '\n');
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

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Start session error response sent (daemon error)');
    }
  }

  /**
   * Handle stop session request.
   */
  private handleStopSessionRequest(socket: Socket, request: StopSessionRequest): void {
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

        socket.write(JSON.stringify(response) + '\n');
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

        socket.write(JSON.stringify(response) + '\n');
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

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Stop session response sent');
    } catch (error) {
      const response: StopSessionResponse = {
        type: 'stop_session_response',
        sessionId: request.sessionId,
        status: 'error',
        message: `Failed to stop session: ${getErrorMessage(error)}`,
        errorCode: IPCErrorCode.DAEMON_ERROR,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Stop session error response sent');
    }
  }

  /**
   * Handle response from worker (lifecycle signals or command responses).
   */
  private handleWorkerResponse(message: WorkerIPCResponse | WorkerResponseUnion): void {
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
      const pending = this.pendingDomRequests.get(message.requestId);
      if (!pending) {
        console.error(`[daemon] No pending request found for requestId: ${message.requestId}`);
        return;
      }

      // Clear timeout and remove from pending
      clearTimeout(pending.timeout);
      this.pendingDomRequests.delete(message.requestId);

      // Forward response to client (pass pending data for special handling)
      this.forwardCommandResponse(pending.socket, pending.sessionId, message, pending);
    }
  }

  private handleWorkerExit(code: number | null, signal: NodeJS.Signals | null): void {
    console.error(
      `[daemon] Worker exit detected (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
    );

    if (this.pendingDomRequests.size === 0) {
      return;
    }

    const errorMessage = 'Worker process exited before responding';

    for (const [requestId, pending] of this.pendingDomRequests.entries()) {
      clearTimeout(pending.timeout);
      this.pendingDomRequests.delete(requestId);

      if (pending.commandName === 'worker_status') {
        const statusResponse: StatusResponse = {
          type: 'status_response',
          sessionId: pending.sessionId,
          status: 'error',
          ...(pending.statusData && { data: pending.statusData }),
          error: errorMessage,
        };
        pending.socket.write(JSON.stringify(statusResponse) + '\n');
        continue;
      }

      if (pending.commandName === 'worker_peek') {
        const peekResponse: PeekResponse = {
          type: 'peek_response',
          sessionId: pending.sessionId,
          status: 'error',
          error: errorMessage,
        };
        pending.socket.write(JSON.stringify(peekResponse) + '\n');
        continue;
      }

      if (pending.commandName) {
        const response = {
          type: `${pending.commandName}_response` as const,
          sessionId: pending.sessionId,
          status: 'error',
          error: errorMessage,
        } satisfies ClientResponse<CommandName>;
        pending.socket.write(JSON.stringify(response) + '\n');
        continue;
      }

      const fallback: StatusResponse = {
        type: 'status_response',
        sessionId: pending.sessionId,
        status: 'error',
        error: errorMessage,
      };
      pending.socket.write(JSON.stringify(fallback) + '\n');
    }
  }

  /**
   * Generic forwarder for all command responses.
   */
  private forwardCommandResponse(
    socket: Socket,
    sessionId: string,
    workerResponse: WorkerResponseUnion,
    pendingRequest?: PendingDomRequest
  ): void {
    const commandName = getCommandName(workerResponse.type);
    if (!commandName) {
      console.error(`[daemon] Invalid worker response type: ${workerResponse.type}`);
      return;
    }

    // Special handling for worker_status - merge with base status data
    if (commandName === 'worker_status') {
      const {
        requestId: _requestId,
        success,
        data,
        error,
      } = workerResponse as WorkerResponse<'worker_status'>;

      // Get base status data from pending request
      const baseStatusData = pendingRequest?.statusData;

      if (success && data && baseStatusData) {
        // Merge worker activity data with base status data
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

        socket.write(JSON.stringify(statusResponse) + '\n');
        console.error(
          '[daemon] Forwarded worker_status_response to client (enriched with activity data)'
        );
      } else {
        // Fallback to base status data if worker query failed
        if (baseStatusData) {
          const statusResponse: StatusResponse = {
            type: 'status_response',
            sessionId,
            status: error ? 'error' : 'ok',
            data: baseStatusData,
            ...(error && { error }),
          };

          socket.write(JSON.stringify(statusResponse) + '\n');
          console.error(
            '[daemon] Forwarded status_response to client (worker query failed, using base data only)'
          );
        } else {
          const statusResponse: StatusResponse = {
            type: 'status_response',
            sessionId,
            status: 'error',
            error: error ?? 'Failed to retrieve status data',
          };

          socket.write(JSON.stringify(statusResponse) + '\n');
          console.error('[daemon] Forwarded status_response error (no base data available)');
        }
      }
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
      socket.write(JSON.stringify(peekResponse) + '\n');
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

    socket.write(JSON.stringify(response) + '\n');
    console.error(`[daemon] Forwarded ${commandName}_response to client`);
  }

  /**
   * Generic handler for all command requests.
   */
  private handleCommandRequest(socket: Socket, request: ClientRequestUnion): void {
    const commandName = getCommandName(request.type);
    if (!commandName) {
      console.error(`[daemon] Invalid command type: ${request.type}`);
      return;
    }

    console.error(`[daemon] ${commandName} request received (sessionId: ${request.sessionId})`);

    if (!this.workerManager.hasActiveWorker()) {
      const response: ClientResponse<typeof commandName> = {
        type: `${commandName}_response` as const,
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker process',
      };
      socket.write(JSON.stringify(response) + '\n');
      console.error(`[daemon] ${commandName} error response sent (no worker)`);
      return;
    }

    const requestId = `${commandName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timeout = setTimeout(() => {
      this.pendingDomRequests.delete(requestId);
      const response: ClientResponse<typeof commandName> = {
        type: `${commandName}_response` as const,
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (10s)',
      };
      socket.write(JSON.stringify(response) + '\n');
      console.error(`[daemon] ${commandName} timeout response sent`);
    }, 10000);

    this.pendingDomRequests.set(requestId, {
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
      clearTimeout(timeout);
      this.pendingDomRequests.delete(requestId);
      const response: ClientResponse<typeof commandName> = {
        type: `${commandName}_response` as const,
        sessionId: request.sessionId,
        status: 'error',
        error: getErrorMessage(error),
      };
      socket.write(JSON.stringify(response) + '\n');
      console.error(
        `[daemon] Failed to forward ${commandName}_request to worker: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Stop the IPC server and cleanup.
   */
  async stop(): Promise<void> {
    await this.socketServer.stop();
    this.workerManager.dispose();

    // Cleanup files
    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    try {
      unlinkSync(socketPath);
    } catch {
      // Ignore if already deleted
    }
    const pidPath = getSessionFilePath('DAEMON_PID');
    try {
      unlinkSync(pidPath);
    } catch {
      // Ignore if already deleted
    }
  }

  /**
   * Write daemon PID to file for tracking.
   */
  private writePidFile(): void {
    const pidPath = getSessionFilePath('DAEMON_PID');
    try {
      writeFileSync(pidPath, process.pid.toString(), 'utf-8');
      releaseDaemonLock(); // Release lock after PID is written (P0 Fix #1)
      console.error(`[daemon] PID file written: ${pidPath}`);
    } catch (error) {
      console.error('[daemon] Failed to write PID file:', error);
    }
  }

  /**
   * Check if daemon is already running.
   */
  static isRunning(): boolean {
    const pidPath = getSessionFilePath('DAEMON_PID');
    try {
      const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
      // Check if process is alive
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get socket path for client connections.
   */
  static getSocketPath(): string {
    return getDaemonSocketPath();
  }
}
