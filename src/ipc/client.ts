/**
 * IPC Client - Minimal JSONL handshake MVP
 *
 * Connects to the daemon's Unix domain socket and performs handshake.
 */

import { randomUUID } from 'crypto';
import { connect } from 'net';

import type { Socket } from 'net';

import { IPCServer } from '@/daemon/ipcServer.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  StatusRequest,
  StatusResponse,
} from '@/ipc/types.js';

/**
 * Connect to the daemon and perform handshake.
 *
 * @returns Handshake response from daemon
 * @throws Error if connection fails or handshake times out
 */
export async function connectToDaemon(): Promise<HandshakeResponse> {
  const socketPath = IPCServer.getSocketPath();
  const sessionId = randomUUID();

  return new Promise((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    let buffer = '';
    let resolved = false;

    // Set connection timeout
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error('Handshake timeout after 5s'));
      }
    }, 5000);

    socket.on('connect', () => {
      console.error('[client] Connected to daemon');

      // Send handshake request
      const request: HandshakeRequest = {
        type: 'handshake_request',
        sessionId,
      };

      socket.write(JSON.stringify(request) + '\n');
      console.error('[client] Handshake request sent');
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Process complete JSONL frames
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim() && !resolved) {
          try {
            const response = JSON.parse(line) as HandshakeResponse;
            console.error('[client] Handshake response received');

            resolved = true;
            clearTimeout(timeout);
            socket.destroy();
            resolve(response);
          } catch (error) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              reject(
                new Error(
                  `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`
                )
              );
            }
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${err.message}`));
      }
    });

    socket.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error('Connection closed before handshake completed'));
      }
    });
  });
}

/**
 * Request status information from the daemon.
 *
 * @returns Status response with daemon and session metadata
 * @throws Error if connection fails, daemon is not running, or request times out
 */
export async function getStatus(): Promise<StatusResponse> {
  const socketPath = IPCServer.getSocketPath();
  const sessionId = randomUUID();

  return new Promise((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    let buffer = '';
    let resolved = false;

    // Set request timeout
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error('Status request timeout after 5s'));
      }
    }, 5000);

    socket.on('connect', () => {
      console.error('[client] Connected to daemon for status request');

      // Send status request
      const request: StatusRequest = {
        type: 'status_request',
        sessionId,
      };

      socket.write(JSON.stringify(request) + '\n');
      console.error('[client] Status request sent');
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');

      // Process complete JSONL frames
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim() && !resolved) {
          try {
            const response = JSON.parse(line) as StatusResponse;
            console.error('[client] Status response received');

            resolved = true;
            clearTimeout(timeout);
            socket.destroy();
            resolve(response);
          } catch (error) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              reject(
                new Error(
                  `Failed to parse status response: ${error instanceof Error ? error.message : String(error)}`
                )
              );
            }
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${err.message}`));
      }
    });

    socket.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error('Connection closed before status response received'));
      }
    });
  });
}
