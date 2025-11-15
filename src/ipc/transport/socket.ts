/**
 * Socket Connection Manager
 *
 * Manages Unix domain socket connections with proper cleanup.
 */

import { connect } from 'net';

import type { Socket } from 'net';

import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('client');

export interface SocketConfig {
  socketPath: string;
  timeoutMs: number;
  requestName: string;
}

export interface SocketHandlers {
  onConnect?: (socket: Socket) => void;
  onData?: (chunk: string) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onEnd?: () => void;
  onTimeout?: () => void;
}

/**
 * Create and configure a socket connection with event handlers.
 */
export function createSocket(
  config: SocketConfig,
  handlers: SocketHandlers
): { socket: Socket; cleanup: () => void } {
  const socket: Socket = connect(config.socketPath);
  let timeoutHandle: NodeJS.Timeout | null = null;

  socket.setEncoding('utf8');
  socket.setNoDelay(true);

  if (handlers.onTimeout) {
    timeoutHandle = setTimeout(() => {
      handlers.onTimeout?.();
    }, config.timeoutMs);
  }

  if (handlers.onConnect) {
    socket.once('connect', () => {
      log.debug(`Connected to daemon for ${config.requestName} request`);
      handlers.onConnect?.(socket);
    });
  }

  if (handlers.onData) {
    socket.on('data', handlers.onData);
  }

  if (handlers.onError) {
    socket.once('error', handlers.onError);
  }

  if (handlers.onClose) {
    socket.once('close', handlers.onClose);
  }

  if (handlers.onEnd) {
    socket.once('end', handlers.onEnd);
  }

  const cleanup = (): void => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    socket.destroy();
  };

  return { socket, cleanup };
}
