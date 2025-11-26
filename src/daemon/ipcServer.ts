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
import { getErrorMessage } from '@/utils/errors.js';

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

  private readonly requestHandlers: RequestHandlers;
  private readonly responseHandler: ResponseHandler;

  constructor() {
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
    ensureSessionDir();

    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    await this.socketServer.start(socketPath, (socket) => this.handleConnection(socket));
    this.writePidFile();
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: Socket): void {
    log.debug('Client connected');

    let buffer = '';

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(socket, line);
        }
      }
    });

    socket.on('end', () => {
      log.debug('Client disconnected');
    });

    socket.on('error', (err) => {
      log.debug(`Socket error: ${getErrorMessage(err)}`);
    });
  }

  /**
   * Handle incoming JSONL message - route to appropriate handler.
   */
  private handleMessage(socket: Socket, line: string): void {
    log.debug(`Raw frame: ${line}`);

    try {
      const parsed: unknown = JSON.parse(line);

      if (!isValidIPCMessage(parsed)) {
        log.debug(`Invalid message structure: missing 'type' or 'sessionId' field`);
        return;
      }

      const message = parsed;

      if (isCommandRequest(message.type)) {
        this.requestHandlers.handleCommandRequest(socket, message as ClientRequestUnion);
        return;
      }

      if (message.type.endsWith('_response')) {
        log.debug(`Unexpected response message from client: ${message.type}`);
        return;
      }

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
        case 'har_data_request':
          this.requestHandlers.handleHARDataRequest(socket, message);
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
        case 'har_data_response':
        case 'start_session_response':
        case 'stop_session_response':
          log.debug(`Unexpected response message received: ${message.type}`);
          break;
      }
    } catch (error) {
      log.debug(`Failed to parse IPC message: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Stop the IPC server and cleanup.
   */
  async stop(): Promise<void> {
    await this.socketServer.stop();
    this.workerManager.dispose();

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
