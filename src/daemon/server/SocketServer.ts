import { unlinkSync } from 'fs';
import { createServer, type Server, type Socket } from 'net';

import { createLogger } from '@/ui/logging/index.js';

export type ConnectionHandler = (socket: Socket) => void;

/**
 * Thin wrapper around Node's net.Server that centralizes socket lifecycle
 * management (setup, connection tracking, teardown).
 */
export class SocketServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private socketPath: string | null = null;
  private readonly log = createLogger('daemon');

  /**
   * Start listening on the provided Unix domain socket path.
   */
  async start(socketPath: string, handler: ConnectionHandler): Promise<void> {
    this.socketPath = socketPath;
    this.cleanupStaleSocket();

    await new Promise<void>((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        handler(socket);
      });

      this.server.on('error', (error) => {
        console.error(`[daemon] Socket server error: ${error.message}`);
        reject(error);
      });

      this.server.listen(socketPath, () => {
        this.log.info(`[daemon] IPC server listening on ${socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server and clean up the socket file.
   */
  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          this.log.info('[daemon] IPC server stopped');
          resolve();
        });
      });
      this.server = null;
    }

    this.cleanupStaleSocket();
    this.socketPath = null;
  }

  private cleanupStaleSocket(): void {
    if (!this.socketPath) {
      return;
    }

    try {
      unlinkSync(this.socketPath);
    } catch (error) {
      this.log.debug(
        `Failed to remove socket file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
