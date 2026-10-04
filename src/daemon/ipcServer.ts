/**
 * Daemon IPC Server
 *
 * Listens on the daemon Unix socket, parses JSONL requests and routes them to
 * the {@link SessionController}. The daemon hosts exactly one session and shuts
 * itself down when that session ends.
 */

import { unlinkSync } from 'fs';

import type { Socket } from 'net';

import { SessionController } from '@/daemon/SessionController.js';
import { SocketServer } from '@/daemon/server/SocketServer.js';
import { type ClientRequestUnion, type IPCMessageType, isCommandRequest } from '@/ipc/index.js';
import { JSONLBuffer, toJSONLFrame } from '@/ipc/transport/jsonl.js';
import { ensureSessionDir, getSessionFilePath } from '@/session/paths.js';
import { readDaemonPid } from '@/session/pid.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('daemon');

/** Delay before exiting after a session ends, so the final response flushes. */
const SHUTDOWN_DELAY_MS = 100;

/** Upper bound on waiting for in-flight requests during shutdown. */
const IN_FLIGHT_WAIT_MS = 30000;
const IN_FLIGHT_POLL_MS = 50;

/**
 * How long a freshly started daemon waits for a session before exiting. The
 * client that spawned it sends its start request within milliseconds; the
 * wait only matters when that client was interrupted before sending it.
 */
const IDLE_SHUTDOWN_MS = 3000;

/**
 * Type guard to validate parsed JSON has expected message structure.
 *
 * @param obj - Parsed JSON value
 * @returns True if the value looks like an IPC message
 */
function isValidIPCMessage(obj: unknown): obj is IPCMessageType | ClientRequestUnion {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  return 'type' in obj && typeof obj.type === 'string' && 'sessionId' in obj;
}

/**
 * IPC Server for the daemon process.
 */
export class IPCServer {
  private readonly startTime: number = Date.now();
  private readonly socketServer = new SocketServer();
  private readonly controller: SessionController;
  private shuttingDown = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private inFlightRequests = 0;

  constructor() {
    this.controller = new SessionController(
      this.startTime,
      getSessionFilePath('DAEMON_SOCKET'),
      () => this.scheduleShutdown()
    );
  }

  /**
   * Start the server and write the daemon PID file.
   */
  async start(): Promise<void> {
    ensureSessionDir();
    const socketPath = getSessionFilePath('DAEMON_SOCKET');
    await this.socketServer.start(socketPath, (socket) => this.handleConnection(socket));
    this.writePidFile();
    this.idleTimer = setTimeout(() => {
      if (this.controller.isIdle()) {
        log.info('No session started, shutting down idle daemon');
        this.scheduleShutdown();
      }
    }, IDLE_SHUTDOWN_MS);
  }

  /**
   * Stop the session (if any) and the server, then exit the process.
   *
   * Used by signal handlers. Idempotent.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    await this.controller.stopActiveSession();
    await this.waitForInFlightRequests();
    await delay(SHUTDOWN_DELAY_MS);
    await this.stop();
    process.exit(0);
  }

  /**
   * Stop the server and remove the socket and PID files, if they are still this daemon's.
   *
   * Never throws; safe to call before start() or more than once.
   */
  async stop(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await this.socketServer.stop();
    if (readDaemonPid() !== process.pid) return;
    try {
      unlinkSync(getSessionFilePath('DAEMON_PID'));
    } catch (error) {
      log.debug(`Failed to remove daemon PID file: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Stop accepting clients and exit shortly after, so in-flight responses flush.
   */
  private scheduleShutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.controller.refuseNewSessions();
    this.socketServer.unpublish();
    void (async () => {
      await this.waitForInFlightRequests();
      await this.controller.stopActiveSession();
      await delay(SHUTDOWN_DELAY_MS);
      log.info('Session ended, shutting down daemon');
      await this.stop();
      process.exit(0);
    })();
  }

  /**
   * Wait until requests already being handled have been answered.
   *
   * E.g. a `stop` that aborts a launching session must still get its response
   * after the failed launch has triggered shutdown.
   */
  private async waitForInFlightRequests(): Promise<void> {
    const deadline = Date.now() + IN_FLIGHT_WAIT_MS;
    while (this.inFlightRequests > 0 && Date.now() < deadline) {
      await delay(IN_FLIGHT_POLL_MS);
    }
  }

  /**
   * Wire up JSONL parsing for a client connection.
   *
   * @param socket - Client socket
   */
  private handleConnection(socket: Socket): void {
    log.debug('Client connected');
    const buffer = new JSONLBuffer();
    const disconnected = new AbortController();
    socket.on('close', () => disconnected.abort());

    socket.on('data', (chunk: Buffer) => {
      try {
        for (const line of buffer.process(chunk.toString('utf-8'))) {
          void this.handleMessage(socket, line, disconnected.signal);
        }
      } catch (error) {
        log.info(`Dropping client connection: ${getErrorMessage(error)}`);
        socket.destroy();
      }
    });
    socket.on('error', (err) => {
      log.debug(`Socket error: ${getErrorMessage(err)}`);
    });
  }

  /**
   * Parse, route and answer one request line.
   *
   * @param socket - Client socket
   * @param line - Raw JSONL frame
   * @param disconnected - Aborted when the client disconnects
   */
  private async handleMessage(
    socket: Socket,
    line: string,
    disconnected: AbortSignal
  ): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      log.debug(`Failed to parse IPC message: ${getErrorMessage(error)}`);
      return;
    }
    if (!isValidIPCMessage(message)) {
      log.debug(`Invalid message structure: missing 'type' or 'sessionId' field`);
      return;
    }

    this.inFlightRequests++;
    try {
      const response = await this.route(message, disconnected);
      if (response !== null && !socket.destroyed) {
        socket.write(toJSONLFrame(response));
      }
    } finally {
      this.inFlightRequests--;
    }
  }

  /**
   * Dispatch a validated message to the controller.
   *
   * @param message - Client request
   * @param disconnected - Aborted when the client disconnects
   * @returns Response to send, or null for messages that need no reply
   */
  private async route(
    message: IPCMessageType | ClientRequestUnion,
    disconnected: AbortSignal
  ): Promise<unknown> {
    if (isCommandRequest(message.type)) {
      return this.controller.command(message as ClientRequestUnion);
    }
    switch (message.type) {
      case 'handshake_request':
        return this.controller.handshake(message);
      case 'status_request':
        return this.controller.status(message);
      case 'peek_request':
        return this.controller.peek(message);
      case 'har_data_request':
        return this.controller.harData(message);
      case 'start_session_request':
        return this.controller.startSession(message, disconnected);
      case 'stop_session_request':
        return this.controller.stopSession(message);
      case 'handshake_response':
      case 'status_response':
      case 'peek_response':
      case 'har_data_response':
      case 'start_session_response':
      case 'stop_session_response':
        log.debug(`Unexpected response message from client: ${message.type}`);
        return null;
    }
  }

  /**
   * Write the daemon PID file (informational; liveness is checked via the socket).
   */
  private writePidFile(): void {
    const pidPath = getSessionFilePath('DAEMON_PID');
    try {
      AtomicFileWriter.writeSync(pidPath, process.pid.toString(), { encoding: 'utf-8' });
      log.info(`PID file written: ${pidPath}`);
    } catch (error) {
      log.info(`Failed to write PID file: ${getErrorMessage(error)}`);
    }
  }
}
