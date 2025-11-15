/**
 * Port reservation utilities for Chrome launcher.
 *
 * Provides atomic port reservation to prevent race conditions during
 * Chrome launch when multiple processes might try to bind to the same port.
 */

import * as net from 'net';

import { portInUseError } from '@/ui/messages/chrome.js';

import { ChromeLaunchError } from './errors.js';

/**
 * Port reservation handle with release function.
 */
export interface PortReservation {
  /** Release the port reservation */
  release: () => void;
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
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new ChromeLaunchError(portInUseError(port)));
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
