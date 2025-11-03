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

import type { Server, Socket } from 'net';

import { launchSessionInWorker, WorkerStartError } from '@/daemon/startSession.js';
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
} from '@/ipc/types.js';
import { IPCErrorCode } from '@/ipc/types.js';
import { filterDefined } from '@/utils/objects.js';
import {
  ensureSessionDir,
  getDaemonPidPath,
  getDaemonSocketPath,
  readPid,
  readSessionMetadata,
  readPartialOutput,
  isProcessAlive,
  cleanupSession,
} from '@/utils/session.js';

/**
 * Simple JSONL IPC server for daemon communication.
 */
export class IPCServer {
  private server: Server | null = null;
  private clients: Set<Socket> = new Set();
  private readonly startTime: number = Date.now();

  /**
   * Start the IPC server on Unix domain socket.
   */
  async start(): Promise<void> {
    // Ensure ~/.bdg directory exists
    ensureSessionDir();

    // Clean up stale socket if exists
    const socketPath = getDaemonSocketPath();
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
        socketPath: getDaemonSocketPath(),
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
    const socketPath = getDaemonSocketPath();
    try {
      unlinkSync(socketPath);
    } catch {
      // Ignore if already deleted
    }
    const pidPath = getDaemonPidPath();
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
    const pidPath = getDaemonPidPath();
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
    const pidPath = getDaemonPidPath();
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
