/**
 * Daemon IPC Server
 *
 * Coordinates socket server, worker manager, and request/response handlers.
 * Responsibilities:
 * - Socket lifecycle management
 * - Message routing
 * - Delegation to specialized handlers
 */

import { unlinkSync } from 'fs';

import type { Socket } from 'net';

import { getErrorMessage } from '@/connection/errors.js';
import { PendingRequestManager } from '@/daemon/handlers/pendingRequests.js';
import { RequestHandlers } from '@/daemon/handlers/requestHandlers.js';
import { ResponseHandler } from '@/daemon/handlers/responseHandler.js';
import { SocketServer } from '@/daemon/server/SocketServer.js';
import { WorkerManager } from '@/daemon/server/WorkerManager.js';
import { SessionService } from '@/daemon/services/SessionService.js';
import { type ClientRequestUnion, type IPCMessageType, isCommandRequest } from '@/ipc/index.js';
import { releaseDaemonLock } from '@/session/lock.js';
import { ensureSessionDir, getSessionFilePath, getDaemonSocketPath } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { createLogger } from '@/ui/logging/index.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

const log = createLogger('daemon');

/**
 * Type guard to validate parsed JSON has expected message structure.
 */
function isValidIPCMessage(obj: unknown): obj is IPCMessageType | ClientRequestUnion {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  return 'type' in obj && typeof obj.type === 'string' && 'sessionId' in obj;
}

/**
 * Simple JSONL IPC server for daemon communication.
 */
export class IPCServer {
  private readonly startTime: number = Date.now();
  private readonly socketServer = new SocketServer();
  private readonly workerManager = new WorkerManager();
  private readonly pendingRequests = new PendingRequestManager();
  private readonly sessionService = new SessionService();

  // Delegate handlers
  private readonly requestHandlers: RequestHandlers;
  private readonly responseHandler: ResponseHandler;

  constructor() {
    // Initialize handlers with dependencies
    this.requestHandlers = new RequestHandlers(
      this.workerManager,
      this.pendingRequests,
      this.sessionService,
      (socket, response) => this.sendResponse(socket, response),
      this.startTime
    );

    this.responseHandler = new ResponseHandler(
      this.pendingRequests,
      this.sessionService,
      (socket, response) => this.sendResponse(socket, response)
    );

    // Wire up worker events
    this.workerManager.on('message', (message) =>
      this.responseHandler.handleWorkerResponse(message)
    );
    this.workerManager.on('exit', (code, signal) =>
      this.responseHandler.handleWorkerExit(code, signal)
    );
  }

  /**
   * Send a JSONL response to client socket.
   */
  private sendResponse(socket: Socket, response: unknown): void {
    socket.write(JSON.stringify(response) + '\n');
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
   * Handle incoming JSONL message - route to appropriate handler.
   */
  private handleMessage(socket: Socket, line: string): void {
    console.error('[daemon] Raw frame:', line);

    try {
      // Parse message - could be either IPC message or command request
      const parsed: unknown = JSON.parse(line);

      if (!isValidIPCMessage(parsed)) {
        console.error('[daemon] Invalid message structure:', parsed);
        return;
      }

      const message = parsed;

      // Check if this is a command request
      if (isCommandRequest(message.type)) {
        this.requestHandlers.handleCommandRequest(socket, message as ClientRequestUnion);
        return;
      }

      // Filter out response messages (should never be received from client)
      if (message.type.endsWith('_response')) {
        console.error(`[daemon] Unexpected response message from client: ${message.type}`);
        return;
      }

      // Route to appropriate handler
      switch (message.type) {
        case 'handshake_request':
          this.requestHandlers.handleHandshake(socket, message);
          break;
        case 'status_request':
          this.requestHandlers.handleStatusRequest(socket, message);
          break;
        case 'peek_request':
          this.requestHandlers.handlePeekRequest(socket, message);
          break;
        case 'start_session_request':
          void this.requestHandlers.handleStartSessionRequest(socket, message);
          break;
        case 'stop_session_request':
          this.requestHandlers.handleStopSessionRequest(socket, message);
          break;
        case 'handshake_response':
        case 'status_response':
        case 'peek_response':
        case 'start_session_response':
        case 'stop_session_response':
          // Already filtered above, but keeping cases for exhaustiveness check
          console.error('[daemon] Unexpected response message (should have been filtered)');
          break;
      }
    } catch (error) {
      console.error('[daemon] Failed to parse message:', error);
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
    } catch (error) {
      log.debug(`Failed to remove socket file: ${getErrorMessage(error)}`);
    }
    const pidPath = getSessionFilePath('DAEMON_PID');
    try {
      unlinkSync(pidPath);
    } catch (error) {
      log.debug(`Failed to remove PID file: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Write daemon PID to file for tracking.
   *
   * Uses AtomicFileWriter to prevent corruption from crashes during write,
   * ensuring daemon.pid is never left in a truncated/corrupt state that
   * would cause parseInt errors during cleanup.
   */
  private writePidFile(): void {
    const pidPath = getSessionFilePath('DAEMON_PID');
    try {
      AtomicFileWriter.writeSync(pidPath, process.pid.toString(), { encoding: 'utf-8' });
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
    const pid = readPidFromFile(pidPath);

    if (pid === null) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      log.debug(`Process ${pid} not alive: ${getErrorMessage(error)}`);
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
