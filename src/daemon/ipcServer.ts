/**
 * Daemon IPC Server - Minimal JSONL handshake MVP
 *
 * Starts a Unix domain socket server that:
 * 1. Listens for JSONL frames (newline-delimited JSON messages)
 * 2. Responds only to handshake requests
 * 3. Logs all incoming frames for debugging
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createServer } from 'net';

import type { ChildProcess } from 'child_process';
import type { Server, Socket } from 'net';

import { launchSessionInWorker, WorkerStartError } from '@/daemon/startSession.js';
import type {
  WorkerIPCResponse,
  WorkerDomQueryResponse,
  WorkerDomHighlightResponse,
  WorkerDomGetResponse,
} from '@/daemon/workerIpc.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  IPCMessageType,
  PeekRequest,
  PeekResponse,
  PeekResponseData,
  StartSessionRequest,
  StartSessionResponse,
  StartSessionResponseData,
  StatusRequest,
  StatusResponse,
  StatusResponseData,
  StopSessionRequest,
  StopSessionResponse,
  DomQueryRequest,
  DomQueryResponse,
  DomHighlightRequest,
  DomHighlightResponse,
  DomGetRequest,
  DomGetResponse,
} from '@/ipc/types.js';
import { IPCErrorCode } from '@/ipc/types.js';
import { cleanupSession } from '@/session/cleanup.js';
import { readSessionMetadata } from '@/session/metadata.js';
import { readPartialOutput } from '@/session/output.js';
import { ensureSessionDir, getSessionFilePath } from '@/session/paths.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Pending DOM request waiting for worker response
 */
interface PendingDomRequest {
  socket: Socket;
  sessionId: string;
  timeout: NodeJS.Timeout;
}

/**
 * Simple JSONL IPC server for daemon communication.
 */
export class IPCServer {
  private server: Server | null = null;
  private clients: Set<Socket> = new Set();
  private readonly startTime: number = Date.now();
  private workerProcess: ChildProcess | null = null;
  private pendingDomRequests: Map<string, PendingDomRequest> = new Map(); // requestId -> pending request

  /**
   * Start the IPC server on Unix domain socket.
   */
  async start(): Promise<void> {
    // Ensure ~/.bdg directory exists
    ensureSessionDir();

    // Clean up stale socket if exists
    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    try {
      unlinkSync(socketPath);
    } catch {
      // Ignore if socket doesn't exist
    }

    this.server = createServer((socket: Socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'));
        return;
      }

      this.server.listen(socketPath, () => {
        console.error(`[daemon] IPC server listening on ${socketPath}`);
        this.writePidFile();
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('[daemon] Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: Socket): void {
    console.error('[daemon] Client connected');
    this.clients.add(socket);

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
      this.clients.delete(socket);
    });

    socket.on('error', (err) => {
      console.error('[daemon] Socket error:', err);
      this.clients.delete(socket);
    });
  }

  /**
   * Handle incoming JSONL message.
   */
  private handleMessage(socket: Socket, line: string): void {
    console.error('[daemon] Raw frame:', line);

    try {
      const message = JSON.parse(line) as IPCMessageType;

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
        case 'dom_query_request':
          this.handleDomQueryRequest(socket, message);
          break;
        case 'dom_query_response':
          console.error('[daemon] Unexpected dom query response from client');
          break;
        case 'dom_highlight_request':
          this.handleDomHighlightRequest(socket, message);
          break;
        case 'dom_highlight_response':
          console.error('[daemon] Unexpected dom highlight response from client');
          break;
        case 'dom_get_request':
          this.handleDomGetRequest(socket, message);
          break;
        case 'dom_get_response':
          console.error('[daemon] Unexpected dom get response from client');
          break;
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
        const metadata = readSessionMetadata();
        if (metadata) {
          data.sessionMetadata = filterDefined({
            bdgPid: metadata.bdgPid,
            chromePid: metadata.chromePid,
            startTime: metadata.startTime,
            port: metadata.port,
            targetId: metadata.targetId,
            webSocketDebuggerUrl: metadata.webSocketDebuggerUrl,
            activeCollectors: metadata.activeCollectors,
          }) as Required<NonNullable<StatusResponseData['sessionMetadata']>>;
        }
      }

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
        error: `Failed to gather status: ${error instanceof Error ? error.message : String(error)}`,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Status error response sent');
    }
  }

  /**
   * Handle peek request.
   */
  private handlePeekRequest(socket: Socket, request: PeekRequest): void {
    console.error(`[daemon] Peek request received (sessionId: ${request.sessionId})`);

    try {
      // Check for active session
      const sessionPid = readPid();
      if (!sessionPid || !isProcessAlive(sessionPid)) {
        const response: PeekResponse = {
          type: 'peek_response',
          sessionId: request.sessionId,
          status: 'error',
          error: 'No active session found',
        };

        socket.write(JSON.stringify(response) + '\n');
        console.error('[daemon] Peek error response sent (no session)');
        return;
      }

      // Read preview data from filesystem
      const previewData = readPartialOutput();
      if (!previewData) {
        const response: PeekResponse = {
          type: 'peek_response',
          sessionId: request.sessionId,
          status: 'error',
          error: 'No preview data available (session may be starting up)',
        };

        socket.write(JSON.stringify(response) + '\n');
        console.error('[daemon] Peek error response sent (no preview data)');
        return;
      }

      // Build response with preview data
      const data: PeekResponseData = {
        sessionPid,
        preview: {
          version: previewData.version,
          success: previewData.success,
          timestamp: previewData.timestamp,
          duration: previewData.duration,
          target: previewData.target,
          data: previewData.data,
          ...(previewData.partial !== undefined && { partial: previewData.partial }),
        },
      };

      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'ok',
        data,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Peek response sent');
    } catch (error) {
      const response: PeekResponse = {
        type: 'peek_response',
        sessionId: request.sessionId,
        status: 'error',
        error: `Failed to get preview: ${error instanceof Error ? error.message : String(error)}`,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Peek error response sent');
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
        const response: StartSessionResponse = {
          type: 'start_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: `Session already running (PID ${sessionPid}). Stop it first with stop_session_request.`,
          errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
        };

        socket.write(JSON.stringify(response) + '\n');
        console.error('[daemon] Start session error response sent (session already running)');
        return;
      }

      // Launch worker
      console.error('[daemon] Launching worker...');
      try {
        const metadata = await launchSessionInWorker(
          request.url,
          filterDefined({
            port: request.port,
            timeout: request.timeout,
            collectors: request.collectors,
            includeAll: request.includeAll,
            userDataDir: request.userDataDir,
            maxBodySize: request.maxBodySize,
          })
        );

        console.error('[daemon] Worker launched successfully');

        // Store worker process for IPC
        this.workerProcess = metadata.workerProcess;

        // Set up worker stdout listener for DOM responses
        this.setupWorkerListener(metadata.workerProcess);

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
          errorMessage = error.message;
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
          errorMessage = error instanceof Error ? error.message : String(error);
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
        message: `Daemon error: ${error instanceof Error ? error.message : String(error)}`,
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
      const metadata = readSessionMetadata();
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
      this.workerProcess = null;
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
        message: `Failed to stop session: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: IPCErrorCode.DAEMON_ERROR,
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] Stop session error response sent');
    }
  }

  /**
   * Set up worker stdout listener for IPC responses.
   */
  private setupWorkerListener(worker: ChildProcess): void {
    let buffer = '';

    if (!worker.stdout) {
      console.error('[daemon] Warning: Worker stdout not available');
      return;
    }

    worker.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Process complete JSONL frames (separated by newlines)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const message = JSON.parse(line) as WorkerIPCResponse;
          this.handleWorkerResponse(message);
        } catch (error) {
          // Ignore parse errors, may be log messages
          console.error(
            `[daemon] Failed to parse worker stdout line: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });

    console.error('[daemon] Worker stdout listener set up');
  }

  /**
   * Handle response from worker.
   */
  private handleWorkerResponse(message: WorkerIPCResponse): void {
    console.error(
      `[daemon] Received worker response: ${message.type} (requestId: ${message.requestId})`
    );

    // Check for ready signal (not a DOM response)
    if (message.type === 'worker_ready') {
      console.error('[daemon] Worker ready signal (already processed during launch)');
      return;
    }

    // Look up pending request
    const pending = this.pendingDomRequests.get(message.requestId);
    if (!pending) {
      console.error(`[daemon] No pending request found for requestId: ${message.requestId}`);
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingDomRequests.delete(message.requestId);

    // Forward response to client based on type
    switch (message.type) {
      case 'dom_query_response':
        this.forwardDomQueryResponse(
          pending.socket,
          pending.sessionId,
          message
        );
        break;
      case 'dom_highlight_response':
        this.forwardDomHighlightResponse(
          pending.socket,
          pending.sessionId,
          message
        );
        break;
      case 'dom_get_response':
        this.forwardDomGetResponse(
          pending.socket,
          pending.sessionId,
          message
        );
        break;
    }
  }

  /**
   * Forward DOM query response from worker to client.
   */
  private forwardDomQueryResponse(
    socket: Socket,
    sessionId: string,
    workerResponse: WorkerDomQueryResponse
  ): void {
    const response: DomQueryResponse = {
      type: 'dom_query_response',
      sessionId,
      status: workerResponse.success ? 'ok' : 'error',
      ...(workerResponse.data && { data: workerResponse.data }),
      ...(workerResponse.error && { error: workerResponse.error }),
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error(`[daemon] Forwarded dom_query_response to client`);
  }

  /**
   * Forward DOM highlight response from worker to client.
   */
  private forwardDomHighlightResponse(
    socket: Socket,
    sessionId: string,
    workerResponse: WorkerDomHighlightResponse
  ): void {
    const response: DomHighlightResponse = {
      type: 'dom_highlight_response',
      sessionId,
      status: workerResponse.success ? 'ok' : 'error',
      ...(workerResponse.data && { data: workerResponse.data }),
      ...(workerResponse.error && { error: workerResponse.error }),
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error(`[daemon] Forwarded dom_highlight_response to client`);
  }

  /**
   * Forward DOM get response from worker to client.
   */
  private forwardDomGetResponse(
    socket: Socket,
    sessionId: string,
    workerResponse: WorkerDomGetResponse
  ): void {
    const response: DomGetResponse = {
      type: 'dom_get_response',
      sessionId,
      status: workerResponse.success ? 'ok' : 'error',
      ...(workerResponse.data && { data: workerResponse.data }),
      ...(workerResponse.error && { error: workerResponse.error }),
    };

    socket.write(JSON.stringify(response) + '\n');
    console.error(`[daemon] Forwarded dom_get_response to client`);
  }

  /**
   * Handle DOM query request from client.
   */
  private handleDomQueryRequest(socket: Socket, request: DomQueryRequest): void {
    console.error(`[daemon] DOM query request received (sessionId: ${request.sessionId})`);

    // Check if worker is available
    if (!this.workerProcess?.stdin) {
      const response: DomQueryResponse = {
        type: 'dom_query_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker process',
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM query error response sent (no worker)');
      return;
    }

    // Generate unique requestId
    const requestId = `dom_query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set up timeout (10 seconds for DOM commands)
    const timeout = setTimeout(() => {
      this.pendingDomRequests.delete(requestId);

      const response: DomQueryResponse = {
        type: 'dom_query_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (10s)',
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM query timeout response sent');
    }, 10000);

    // Store pending request
    this.pendingDomRequests.set(requestId, {
      socket,
      sessionId: request.sessionId,
      timeout,
    });

    // Forward to worker
    const workerRequest = {
      type: 'dom_query_request',
      requestId,
      selector: request.selector,
    };

    this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
    console.error(`[daemon] Forwarded dom_query_request to worker (requestId: ${requestId})`);
  }

  /**
   * Handle DOM highlight request from client.
   */
  private handleDomHighlightRequest(socket: Socket, request: DomHighlightRequest): void {
    console.error(`[daemon] DOM highlight request received (sessionId: ${request.sessionId})`);

    // Check if worker is available
    if (!this.workerProcess?.stdin) {
      const response: DomHighlightResponse = {
        type: 'dom_highlight_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker process',
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM highlight error response sent (no worker)');
      return;
    }

    // Generate unique requestId
    const requestId = `dom_highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set up timeout (10 seconds for DOM commands)
    const timeout = setTimeout(() => {
      this.pendingDomRequests.delete(requestId);

      const response: DomHighlightResponse = {
        type: 'dom_highlight_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (10s)',
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM highlight timeout response sent');
    }, 10000);

    // Store pending request
    this.pendingDomRequests.set(requestId, {
      socket,
      sessionId: request.sessionId,
      timeout,
    });

    // Forward to worker
    const workerRequest = {
      type: 'dom_highlight_request',
      requestId,
      ...(request.selector !== undefined && { selector: request.selector }),
      ...(request.index !== undefined && { index: request.index }),
      ...(request.nodeId !== undefined && { nodeId: request.nodeId }),
      ...(request.first !== undefined && { first: request.first }),
      ...(request.nth !== undefined && { nth: request.nth }),
      ...(request.color !== undefined && { color: request.color }),
      ...(request.opacity !== undefined && { opacity: request.opacity }),
    };

    this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
    console.error(`[daemon] Forwarded dom_highlight_request to worker (requestId: ${requestId})`);
  }

  /**
   * Handle DOM get request from client.
   */
  private handleDomGetRequest(socket: Socket, request: DomGetRequest): void {
    console.error(`[daemon] DOM get request received (sessionId: ${request.sessionId})`);

    // Check if worker is available
    if (!this.workerProcess?.stdin) {
      const response: DomGetResponse = {
        type: 'dom_get_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'No active worker process',
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM get error response sent (no worker)');
      return;
    }

    // Generate unique requestId
    const requestId = `dom_get_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set up timeout (10 seconds for DOM commands)
    const timeout = setTimeout(() => {
      this.pendingDomRequests.delete(requestId);

      const response: DomGetResponse = {
        type: 'dom_get_response',
        sessionId: request.sessionId,
        status: 'error',
        error: 'Worker response timeout (10s)',
      };

      socket.write(JSON.stringify(response) + '\n');
      console.error('[daemon] DOM get timeout response sent');
    }, 10000);

    // Store pending request
    this.pendingDomRequests.set(requestId, {
      socket,
      sessionId: request.sessionId,
      timeout,
    });

    // Forward to worker
    const workerRequest = {
      type: 'dom_get_request',
      requestId,
      ...(request.selector !== undefined && { selector: request.selector }),
      ...(request.index !== undefined && { index: request.index }),
      ...(request.nodeId !== undefined && { nodeId: request.nodeId }),
      ...(request.all !== undefined && { all: request.all }),
      ...(request.nth !== undefined && { nth: request.nth }),
    };

    this.workerProcess.stdin.write(JSON.stringify(workerRequest) + '\n');
    console.error(`[daemon] Forwarded dom_get_request to worker (requestId: ${requestId})`);
  }

  /**
   * Stop the IPC server and cleanup.
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const socket of this.clients) {
      socket.destroy();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          console.error('[daemon] IPC server stopped');
          resolve();
        });
      });
      this.server = null;
    }

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
    return getSessionFilePath('DAEMON_SOCKET');
  }
}
