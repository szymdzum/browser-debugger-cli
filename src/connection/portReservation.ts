/**
 * Port reservation utilities for Chrome launcher.
 *
 * Provides atomic port reservation to prevent race conditions during
 * Chrome launch when multiple processes might try to bind to the same port.
 */

import * as net from 'net';

import { ChromeLaunchError } from './errors.js';

/**
 * Port reservation handle with release function.
 */
export interface PortReservation {
  /** Release the port reservation */
  release: () => void;
}

/** How long a connection attempt may take when checking a port */
const CONNECT_CHECK_MS = 500;

/**
 * Whether something already accepts connections on 127.0.0.1:port. A
 * listener on all interfaces (`0.0.0.0`/`::`) does not stop bdg from binding
 * 127.0.0.1 on macOS, but Chrome would then fail to listen, so it is checked
 * by connecting.
 *
 * @param port - Port to check
 * @returns True if a connection was accepted
 */
export function isPortAnswering(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (answering: boolean): void => {
      socket.destroy();
      resolve(answering);
    };
    socket.setTimeout(CONNECT_CHECK_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * The error for a port another process uses.
 *
 * @param port - Port
 * @returns Launch error with the PORT_IN_USE issue
 */
function portInUseError(port: number): ChromeLaunchError {
  return new ChromeLaunchError(`Port ${port} is already in use`, {
    issue: { code: 'PORT_IN_USE', context: { port } },
  });
}

/**
 * Atomically reserve a port to prevent race conditions during Chrome launch.
 *
 * Creates a temporary TCP server on the port, which prevents other processes
 * from binding to it. Returns a release function to free the port.
 *
 * The port must be released BEFORE launching Chrome so Chrome can bind to it.
 * This function is only for atomically checking availability.
 *
 * @param port - Port number to reserve
 * @returns Promise resolving to reservation object with release function
 * @throws ChromeLaunchError If port is already in use
 *
 * @example
 * ```typescript
 * // Check if port is available
 * const reservation = await reservePort(9222);
 *
 * // Immediately release so Chrome can bind to it
 * reservation.release();
 *
 * // Now launch Chrome on the port
 * const chrome = await launchChrome({ port: 9222 });
 * ```
 */
export async function reservePort(port: number): Promise<PortReservation> {
  if (await isPortAnswering(port)) throw portInUseError(port);
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(portInUseError(port));
      } else {
        reject(err);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      resolve({
        release: () => {
          server.close();
        },
      });
    });
  });
}
