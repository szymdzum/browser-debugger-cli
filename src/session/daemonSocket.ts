/**
 * Daemon liveness via its Unix socket.
 *
 * The socket is the single source of truth: if a connection succeeds the
 * daemon is alive, if it is refused the socket file is stale. PID files are
 * never used to decide liveness.
 */

import * as net from 'net';

import { getSessionFilePath } from '@/session/paths.js';

const PROBE_TIMEOUT_MS = 1000;

/** Result of probing the daemon socket. */
export type SocketProbeResult = 'alive' | 'stale' | 'absent';

/**
 * Probe a Unix socket path.
 *
 * @param socketPath - Socket path (defaults to the session's daemon socket)
 * @param timeoutMs - Connection timeout
 * @returns 'alive' if a server accepted the connection, 'absent' if there is no
 *   socket file, 'stale' if the file exists but nothing is listening
 */
export function probeDaemonSocket(
  socketPath: string = getSessionFilePath('DAEMON_SOCKET'),
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<SocketProbeResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = (result: SocketProbeResult): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish('stale'), timeoutMs);
    socket.once('connect', () => finish('alive'));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(error.code === 'ENOENT' ? 'absent' : 'stale')
    );
  });
}

/**
 * Check whether the daemon is accepting connections.
 *
 * @returns True if the daemon socket accepts a connection
 */
export async function isDaemonAlive(): Promise<boolean> {
  return (await probeDaemonSocket()) === 'alive';
}

/**
 * Whether the daemon socket certainly cannot be reached: there is no socket
 * file, or connecting is refused. A daemon that is only slow to accept (busy,
 * a timeout) does not count, so it is never taken for a dead one.
 *
 * @param socketPath - Socket path (defaults to the session's daemon socket)
 * @param timeoutMs - Connection timeout
 * @returns True when the socket is missing or refuses connections
 */
export function isDaemonSocketGone(
  socketPath: string = getSessionFilePath('DAEMON_SOCKET'),
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = (gone: boolean): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(gone);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(error.code === 'ENOENT' || error.code === 'ECONNREFUSED')
    );
  });
}
