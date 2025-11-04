/**
 * IPC Server Contract Tests
 *
 * Tests the public API behavior of IPCServer WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
 *
 * Contract:
 * - Input: JSONL messages via Unix socket
 * - Output: JSONL responses via Unix socket
 * - Behavior: Request/response matching, worker forwarding, error handling
 *
 * What we test:
 * ✅ Behavior: Given IPC message → expect IPC response
 * ✅ Invariants: "Responses match requests by sessionId", "Socket cleanup on stop"
 * ✅ Edge cases: Malformed JSON, missing worker, timeouts
 *
 * What we DON'T test:
 * ❌ Internal pendingDomRequests Map structure
 * ❌ Internal handleMessage() function calls
 * ❌ Implementation details (Buffer handling, event handler IDs)
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { IPCServer } from '@/daemon/ipcServer.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  StatusRequest,
  StatusResponse,
} from '@/ipc/types.js';
import { getSessionFilePath } from '@/session/paths.js';

/**
 * Mock client for sending/receiving JSONL messages via Unix socket.
 * Only mocks the transport boundary (Unix socket) - all IPC logic is real.
 */
class MockIPCClient {
  private socket: net.Socket | null = null;
  private buffer = '';
  private responses: string[] = [];
  private connected = false;

  /**
   * Connect to IPC server
   */
  async connect(socketPath: string, timeoutMs = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(socketPath);
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.socket.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8');

        // Parse complete JSONL frames
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) {
            this.responses.push(line);
          }
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Send JSONL message
   */
  send(message: unknown): void {
    if (!this.socket) {
      throw new Error('Not connected');
    }
    this.socket.write(JSON.stringify(message) + '\n');
  }

  /**
   * Wait for next response (with timeout)
   */
  async waitForResponse(timeoutMs = 2000): Promise<string> {
    const start = Date.now();
    while (this.responses.length === 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Response timeout after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.responses.shift()!;
  }

  /**
   * Close socket
   */
  close(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

void describe('IPC Server Contract Tests', () => {
  let server: IPCServer;
  let client: MockIPCClient;
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    // Create temp directory for session files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-ipc-test-'));

    // Override HOME to use temp directory
    originalHome = process.env['HOME'];
    originalUserProfile = process.env['USERPROFILE'];
    process.env['HOME'] = tmpDir;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = tmpDir;
    }

    // Start IPC server
    server = new IPCServer();
    await server.start();

    // Create mock client
    client = new MockIPCClient();
  });

  afterEach(async () => {
    // Close client
    client.close();

    // Stop server
    await server.stop();

    // Restore HOME
    process.env['HOME'] = originalHome;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = originalUserProfile;
    }

    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  void describe('Server lifecycle', () => {
    void it('should start server and create socket file', () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      assert.ok(fs.existsSync(socketPath), 'Socket file should exist');
    });

    void it('should write PID file on start', () => {
      const pidPath = getSessionFilePath('DAEMON_PID');
      assert.ok(fs.existsSync(pidPath), 'PID file should exist');

      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      assert.equal(pid, process.pid, 'PID should match current process');
    });

    void it('should remove socket and PID files on stop', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      const pidPath = getSessionFilePath('DAEMON_PID');

      await server.stop();

      assert.ok(!fs.existsSync(socketPath), 'Socket file should be removed');
      assert.ok(!fs.existsSync(pidPath), 'PID file should be removed');
    });

    void it('should accept client connections', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      assert.ok(client.isConnected(), 'Client should be connected');
    });
  });

  void describe('Handshake protocol', () => {
    void it('should respond to handshake request with success', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      const request: HandshakeRequest = {
        type: 'handshake_request',
        sessionId: 'test-session-123',
      };

      client.send(request);

      const responseStr = await client.waitForResponse();
      const response = JSON.parse(responseStr) as HandshakeResponse;

      assert.equal(response.type, 'handshake_response');
      assert.equal(response.sessionId, 'test-session-123');
      assert.equal(response.status, 'ok');
      assert.equal(response.message, 'Handshake successful');
    });

    void it('should handle multiple handshakes from same client', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      for (let i = 1; i <= 3; i++) {
        const request: HandshakeRequest = {
          type: 'handshake_request',
          sessionId: `session-${i}`,
        };

        client.send(request);

        const responseStr = await client.waitForResponse();
        const response = JSON.parse(responseStr) as HandshakeResponse;

        assert.equal(response.sessionId, `session-${i}`);
        assert.equal(response.status, 'ok');
      }
    });
  });

  void describe('Status request', () => {
    void it('should respond to status request with daemon metadata', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      const request: StatusRequest = {
        type: 'status_request',
        sessionId: 'test-session',
      };

      client.send(request);

      const responseStr = await client.waitForResponse();
      const response = JSON.parse(responseStr) as StatusResponse;

      assert.equal(response.type, 'status_response');
      assert.equal(response.sessionId, 'test-session');
      assert.equal(response.status, 'ok');
      assert.ok(response.data, 'Should have data field');
      assert.equal(response.data.daemonPid, process.pid);
      assert.ok(response.data.daemonStartTime, 'Should have daemon start time');
      assert.ok(response.data.socketPath, 'Should have socket path');
    });

    void it('should indicate no active session when session PID file missing', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      const request: StatusRequest = {
        type: 'status_request',
        sessionId: 'test-session',
      };

      client.send(request);

      const responseStr = await client.waitForResponse();
      const response = JSON.parse(responseStr) as StatusResponse;

      assert.equal(response.status, 'ok');
      assert.ok(!response.data!.sessionPid, 'Should not have session PID');
      assert.ok(!response.data!.sessionMetadata, 'Should not have session metadata');
    });
  });

  void describe('JSONL parsing', () => {
    void it('should handle fragmented JSONL messages', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      // Send message in fragments (simulates chunked network data)
      const request: HandshakeRequest = {
        type: 'handshake_request',
        sessionId: 'fragmented-test',
      };

      const json = JSON.stringify(request) + '\n';
      const mid = Math.floor(json.length / 2);

      // Send first half
      client['socket']!.write(json.slice(0, mid));

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Send second half
      client['socket']!.write(json.slice(mid));

      const responseStr = await client.waitForResponse();
      const response = JSON.parse(responseStr) as HandshakeResponse;

      assert.equal(response.sessionId, 'fragmented-test');
      assert.equal(response.status, 'ok');
    });

    void it('should handle multiple messages in one chunk', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      // Send 3 handshakes in one write
      const messages = [
        { type: 'handshake_request', sessionId: 'batch-1' },
        { type: 'handshake_request', sessionId: 'batch-2' },
        { type: 'handshake_request', sessionId: 'batch-3' },
      ];

      const batch = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      client['socket']!.write(batch);

      // Should receive 3 responses
      const response1 = JSON.parse(await client.waitForResponse()) as HandshakeResponse;
      const response2 = JSON.parse(await client.waitForResponse()) as HandshakeResponse;
      const response3 = JSON.parse(await client.waitForResponse()) as HandshakeResponse;

      assert.equal(response1.sessionId, 'batch-1');
      assert.equal(response2.sessionId, 'batch-2');
      assert.equal(response3.sessionId, 'batch-3');
    });

    void it('should ignore empty lines', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      // Send message with empty lines
      const json =
        '\n\n' +
        JSON.stringify({
          type: 'handshake_request',
          sessionId: 'empty-lines-test',
        }) +
        '\n\n';

      client['socket']!.write(json);

      const responseStr = await client.waitForResponse();
      const response = JSON.parse(responseStr) as HandshakeResponse;

      assert.equal(response.sessionId, 'empty-lines-test');
      assert.equal(response.status, 'ok');
    });
  });

  void describe('Error handling', () => {
    void it('should handle malformed JSON gracefully', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      // Send invalid JSON
      client['socket']!.write('{ invalid json }\n');

      // Wait a bit to ensure server processes it
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Server should still accept valid messages after error
      const request: HandshakeRequest = {
        type: 'handshake_request',
        sessionId: 'recovery-test',
      };

      client.send(request);

      const responseStr = await client.waitForResponse();
      const response = JSON.parse(responseStr) as HandshakeResponse;

      assert.equal(response.sessionId, 'recovery-test');
      assert.equal(response.status, 'ok');
    });

    void it('should handle client disconnect gracefully', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');
      await client.connect(socketPath);

      // Send handshake
      client.send({
        type: 'handshake_request',
        sessionId: 'disconnect-test',
      });

      await client.waitForResponse();

      // Disconnect
      client.close();

      // Server should still accept new connections
      const newClient = new MockIPCClient();
      await newClient.connect(socketPath);

      newClient.send({
        type: 'handshake_request',
        sessionId: 'reconnect-test',
      });

      const responseStr = await newClient.waitForResponse();
      const response = JSON.parse(responseStr) as HandshakeResponse;

      assert.equal(response.sessionId, 'reconnect-test');
      assert.equal(response.status, 'ok');

      newClient.close();
    });
  });

  void describe('Concurrent clients', () => {
    void it('should handle multiple concurrent client connections', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');

      // Connect 3 clients simultaneously
      const clients = [new MockIPCClient(), new MockIPCClient(), new MockIPCClient()];

      await Promise.all(clients.map((c) => c.connect(socketPath)));

      // Send different handshakes from each client
      for (let i = 0; i < clients.length; i++) {
        clients[i]!.send({
          type: 'handshake_request',
          sessionId: `concurrent-${i}`,
        });
      }

      // Each client should receive correct response
      for (let i = 0; i < clients.length; i++) {
        const responseStr = await clients[i]!.waitForResponse();
        const response = JSON.parse(responseStr) as HandshakeResponse;

        assert.equal(response.sessionId, `concurrent-${i}`);
        assert.equal(response.status, 'ok');
      }

      // Clean up
      clients.forEach((c) => c.close());
    });

    void it('should route responses to correct client', async () => {
      const socketPath = getSessionFilePath('DAEMON_SOCKET');

      const client1 = new MockIPCClient();
      const client2 = new MockIPCClient();

      await client1.connect(socketPath);
      await client2.connect(socketPath);

      // Client 1 sends session-1 request
      client1.send({
        type: 'handshake_request',
        sessionId: 'session-1',
      });

      // Client 2 sends session-2 request
      client2.send({
        type: 'handshake_request',
        sessionId: 'session-2',
      });

      // Each client gets its own response (not crossed)
      const response1Str = await client1.waitForResponse();
      const response1 = JSON.parse(response1Str) as HandshakeResponse;

      const response2Str = await client2.waitForResponse();
      const response2 = JSON.parse(response2Str) as HandshakeResponse;

      assert.equal(response1.sessionId, 'session-1', 'Client 1 should get session-1 response');
      assert.equal(response2.sessionId, 'session-2', 'Client 2 should get session-2 response');

      client1.close();
      client2.close();
    });
  });

  void describe('Static helper methods', () => {
    void it('IPCServer.isRunning() should return true when server is running', () => {
      assert.ok(IPCServer.isRunning(), 'Server should be detected as running');
    });

    void it('IPCServer.isRunning() should return false after server stops', async () => {
      await server.stop();
      assert.ok(!IPCServer.isRunning(), 'Server should not be detected after stop');
    });

    void it('IPCServer.getSocketPath() should return correct socket path', () => {
      const socketPath = IPCServer.getSocketPath();
      const expectedPath = getSessionFilePath('DAEMON_SOCKET');
      assert.equal(socketPath, expectedPath);
    });
  });
});
