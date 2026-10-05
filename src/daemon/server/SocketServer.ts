import { linkSync, lstatSync, unlinkSync } from 'fs';
import { createServer, type Server, type Socket } from 'net';

import { DaemonError } from '@/daemon/errors.js';
import { probeDaemonSocket } from '@/session/daemonSocket.js';
import { MAX_SOCKET_PATH_BYTES } from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

export type ConnectionHandler = (socket: Socket) => void;

/** Error code thrown when another daemon already owns the socket path. */
export const DAEMON_ALREADY_RUNNING_CODE = 'DAEMON_ALREADY_RUNNING';

/**
 * Thin wrapper around Node's net.Server that centralizes socket lifecycle
 * management (setup, connection tracking, teardown).
 *
 * Claims the socket path exclusively: the server listens on a private
 * temporary path and then hard-links it to the public path. `link()` fails
 * with EEXIST if the path exists, so two daemons can never both own it.
 * On shutdown the public path is removed only if it still refers to our
 * socket inode.
 */
export class SocketServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private socketPath: string | null = null;
  private socketInode: number | null = null;
  private readonly log = createLogger('daemon');

  /**
   * Start listening on the provided Unix domain socket path.
   *
   * @param socketPath - Public socket path to claim
   * @param handler - Connection handler
   * @throws DaemonError with code DAEMON_ALREADY_RUNNING if a live daemon owns the path
   */
  async start(socketPath: string, handler: ConnectionHandler): Promise<void> {
    const privatePath = `${socketPath}.${process.pid}`;
    if (Buffer.byteLength(privatePath) > MAX_SOCKET_PATH_BYTES) {
      throw new DaemonError(
        `Socket path too long (${Buffer.byteLength(privatePath)} bytes, max ${MAX_SOCKET_PATH_BYTES}): ${privatePath}`,
        'SOCKET_PATH_TOO_LONG',
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    this.removeFile(privatePath);
    await this.listen(privatePath, handler);
    try {
      await this.claim(privatePath, socketPath);
      this.socketInode = lstatSync(privatePath).ino;
    } catch (error) {
      await this.closeServer();
      throw error;
    } finally {
      this.removeFile(privatePath);
    }
    this.socketPath = socketPath;
    this.log.info(`IPC server listening on ${socketPath}`);
  }

  /**
   * Remove the public socket file so no new clients can connect, while
   * keeping existing connections open to flush their final responses.
   */
  unpublish(): void {
    if (!this.socketPath) return;
    if (this.ownsPath(this.socketPath)) {
      this.removeFile(this.socketPath);
    }
    this.socketPath = null;
    this.socketInode = null;
  }

  /**
   * Check that a path still refers to the socket this server claimed.
   *
   * Guards against removing another daemon's socket if ours was replaced
   * (e.g. two daemons racing to replace the same stale socket file).
   *
   * @param path - Public socket path
   * @returns True if the path is our socket inode
   */
  private ownsPath(path: string): boolean {
    try {
      return lstatSync(path).ino === this.socketInode;
    } catch {
      return false;
    }
  }

  /**
   * Unpublish the socket, drop all connections and close the server.
   */
  async stop(): Promise<void> {
    this.unpublish();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await this.closeServer();
  }

  /**
   * Listen on a socket path.
   *
   * @param path - Socket path
   * @param handler - Connection handler
   */
  private listen(path: string, handler: ConnectionHandler): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        handler(socket);
      });
      this.server.once('error', reject);
      this.server.listen(path, () => {
        this.server?.off('error', reject);
        this.server?.on('error', (error) => this.log.info(`Socket server error: ${error.message}`));
        resolve();
      });
    });
  }

  /**
   * Atomically publish the listening socket at the public path.
   *
   * A stale socket file (nothing listening) is removed and the claim retried once.
   *
   * @param privatePath - Path the server is listening on
   * @param socketPath - Public path to claim
   * @throws DaemonError if a live daemon already owns the public path
   */
  private async claim(privatePath: string, socketPath: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(privatePath, socketPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      if ((await probeDaemonSocket(socketPath)) === 'alive') break;
      this.log.info('Removing stale daemon socket');
      this.removeFile(socketPath);
    }
    throw new DaemonError(
      'Another bdg daemon is already running',
      DAEMON_ALREADY_RUNNING_CODE,
      EXIT_CODES.DAEMON_ALREADY_RUNNING
    );
  }

  /**
   * Close the underlying server if it is open.
   */
  private async closeServer(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Remove a file, ignoring errors.
   *
   * @param path - File path
   */
  private removeFile(path: string): void {
    try {
      unlinkSync(path);
    } catch (error) {
      this.log.debug(`Failed to remove ${path}: ${getErrorMessage(error)}`);
    }
  }
}
