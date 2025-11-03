/**
 * Daemon IPC Server - Minimal JSONL handshake MVP
 *
 * Starts a Unix domain socket server that:
 * 1. Listens for JSONL frames (newline-delimited JSON messages)
 * 2. Responds only to handshake requests
 * 3. Logs all incoming frames for debugging
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { createServer } from 'net';
import { homedir } from 'os';
import { join } from 'path';

import type { Server, Socket } from 'net';

import type { HandshakeRequest, HandshakeResponse, IPCMessageType } from '@/ipc/types.js';

const BDG_DIR = join(homedir(), '.bdg');
const SOCKET_PATH = join(BDG_DIR, 'daemon.sock');
const PID_FILE = join(BDG_DIR, 'daemon.pid');

/**
 * Simple JSONL IPC server for daemon communication.
 */
export class IPCServer {
  private server: Server | null = null;
  private clients: Set<Socket> = new Set();

  /**
   * Start the IPC server on Unix domain socket.
   */
  async start(): Promise<void> {
    // Ensure ~/.bdg directory exists
    try {
      mkdirSync(BDG_DIR, { recursive: true });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }

    // Clean up stale socket if exists
    try {
      unlinkSync(SOCKET_PATH);
    } catch {
      // Ignore if socket doesn't exist
    }

    this.server = createServer((socket: Socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'));
        return;
      }

      this.server.listen(SOCKET_PATH, () => {
        console.error(`[daemon] IPC server listening on ${SOCKET_PATH}`);
        this.writePidFile();
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('[daemon] Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: Socket): void {
    console.error('[daemon] Client connected');
    this.clients.add(socket);

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
      this.clients.delete(socket);
    });

    socket.on('error', (err) => {
      console.error('[daemon] Socket error:', err);
      this.clients.delete(socket);
    });
  }

  /**
   * Handle incoming JSONL message.
   */
  private handleMessage(socket: Socket, line: string): void {
    console.error('[daemon] Raw frame:', line);

    try {
      const message = JSON.parse(line) as IPCMessageType;

      switch (message.type) {
        case 'handshake_request':
          this.handleHandshake(socket, message);
          break;
        case 'handshake_response':
          // Response messages are sent by daemon, not received
          console.error('[daemon] Unexpected handshake response from client');
          break;
      }
    } catch (error) {
      console.error('[daemon] Failed to parse message:', error);
    }
  }

  /**
   * Handle handshake request.
   */
  private handleHandshake(socket: Socket, request: HandshakeRequest): void {
    console.error(`[daemon] Handshake request received (sessionId: ${request.sessionId})`);

    const response: HandshakeResponse = {
      type: 'handshake_response',
      sessionId: request.sessionId,
      status: 'ok',
      message: 'Handshake successful',
    };

    // Send JSONL response (JSON + newline)
    socket.write(JSON.stringify(response) + '\n');
    console.error('[daemon] Handshake response sent');
  }

  /**
   * Stop the IPC server and cleanup.
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const socket of this.clients) {
      socket.destroy();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => {
          console.error('[daemon] IPC server stopped');
          resolve();
        });
      });
      this.server = null;
    }

    // Cleanup files
    try {
      unlinkSync(SOCKET_PATH);
    } catch {
      // Ignore if already deleted
    }
    try {
      unlinkSync(PID_FILE);
    } catch {
      // Ignore if already deleted
    }
  }

  /**
   * Write daemon PID to file for tracking.
   */
  private writePidFile(): void {
    try {
      writeFileSync(PID_FILE, process.pid.toString(), 'utf-8');
      console.error(`[daemon] PID file written: ${PID_FILE}`);
    } catch (error) {
      console.error('[daemon] Failed to write PID file:', error);
    }
  }

  /**
   * Check if daemon is already running.
   */
  static isRunning(): boolean {
    try {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      // Check if process is alive
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get socket path for client connections.
   */
  static getSocketPath(): string {
    return SOCKET_PATH;
  }
}
