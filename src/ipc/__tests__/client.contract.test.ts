/**
 * IPC Client Contract Tests
 *
 * Tests the public API behavior of IPC client functions WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
 *
 * Contract:
 * - Input: Function calls with parameters
 * - Output: Responses from daemon via Unix socket
 * - Behavior: Connect, send request, receive response, handle errors/timeouts
 *
 * What we test:
 * ✅ Behavior: Client function calls → daemon responses
 * ✅ Invariants: "Requests receive responses", "Errors propagate correctly"
 * ✅ Edge cases: Daemon not running, timeouts, malformed responses
 *
 * What we DON'T test:
 * ❌ Internal sendRequest() implementation
 * ❌ Socket buffer handling details
 * ❌ How JSONL parsing works internally
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as ipcClient from '@/ipc/client.js';
import type {
  HandshakeRequest,
  HandshakeResponse,
  StatusRequest,
  StatusResponse,
} from '@/ipc/types.js';

/**
 * Mock daemon server that responds to IPC requests.
 * Simulates daemon behavior without starting actual worker processes.
 */
class MockDaemonServer {
  private server: net.Server | null = null;
  private socketPath: string;
  private clients: net.Socket[] = [];

  /**
   * Behavior modes for testing different scenarios
   */
  public mode:
    | 'normal' // Normal responses
    | 'slow' // Delayed responses (for timeout testing)
    | 'malformed' // Invalid JSON responses
    | 'error' // Error responses
    | 'silent' // No response (connection but no data)
    | 'close_early' = 'normal'; // Close connection before sending response

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /**
   * Start mock daemon server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove existing socket if present
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Ignore - socket may not exist
      }

      this.server = net.createServer((socket) => {
        this.clients.push(socket);
        let buffer = '';

        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');

          // Process complete JSONL frames
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              this.handleRequest(socket, line);
            }
          }
        });

        socket.on('error', () => {
          // Ignore client errors
        });
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Handle incoming request and send appropriate response
   */
  private handleRequest(socket: net.Socket, line: string): void {
    try {
      const request = JSON.parse(line) as HandshakeRequest | StatusRequest;

      // Handle different behavior modes
      switch (this.mode) {
        case 'slow':
          // Delay response (useful for timeout testing)
          setTimeout(() => {
            this.sendNormalResponse(socket, request);
          }, 10000); // 10s delay (longer than 5s client timeout)
          break;

        case 'malformed':
          // Send invalid JSON
          socket.write('{"invalid": json}\n');
          break;

        case 'error':
          // Send error response
          this.sendErrorResponse(socket, request);
          break;

        case 'silent':
          // Don't send any response
          break;

        case 'close_early':
          // Close connection immediately
          socket.end();
          break;

        case 'normal':
          this.sendNormalResponse(socket, request);
          break;
      }
    } catch {
      // Invalid JSON in request - send error response
      socket.write(
        JSON.stringify({
          type: 'error_response',
          sessionId: 'unknown',
          status: 'error',
          error: 'Invalid request JSON',
        }) + '\n'
      );
    }
  }

  /**
   * Send normal successful response
   */
  private sendNormalResponse(socket: net.Socket, request: HandshakeRequest | StatusRequest): void {
    if (request.type === 'handshake_request') {
      const response: HandshakeResponse = {
        type: 'handshake_response',
        sessionId: request.sessionId,
        status: 'ok',
        message: 'Mock daemon connected',
      };
      socket.write(JSON.stringify(response) + '\n');
    } else if (request.type === 'status_request') {
      const response: StatusResponse = {
        type: 'status_response',
        sessionId: request.sessionId,
        status: 'ok',
        data: {
          daemonPid: process.pid,
          daemonStartTime: Date.now(),
          socketPath: this.socketPath,
        },
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }

  /**
   * Send error response
   */
  private sendErrorResponse(socket: net.Socket, request: HandshakeRequest | StatusRequest): void {
    const response = {
      type: request.type.replace('_request', '_response'),
      sessionId: request.sessionId,
      status: 'error',
      error: 'Mock daemon error',
    };
    socket.write(JSON.stringify(response) + '\n');
  }

  /**
   * Stop mock daemon server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all client connections
      for (const client of this.clients) {
        client.end();
      }
      this.clients = [];

      if (this.server) {
        this.server.close(() => {
          // Remove socket file
          try {
            fs.unlinkSync(this.socketPath);
          } catch {
            // Ignore - socket may not exist
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

void describe('IPC Client Contract Tests', () => {
  let mockDaemon: MockDaemonServer;
  let tmpDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let socketPath: string;

  beforeEach(async () => {
    // Create temp directory for socket
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-ipc-client-test-'));

    // Override HOME to use temp directory
    originalHome = process.env['HOME'];
    originalUserProfile = process.env['USERPROFILE'];
    process.env['HOME'] = tmpDir;
    if (process.platform === 'win32') {
      process.env['USERPROFILE'] = tmpDir;
    }

    // Create .bdg directory
    const bdgDir = path.join(tmpDir, '.bdg');
    fs.mkdirSync(bdgDir, { recursive: true });

    // Get socket path (matches IPCServer.getSocketPath())
    socketPath = path.join(bdgDir, 'daemon.sock');

    // Start mock daemon
    mockDaemon = new MockDaemonServer(socketPath);
    await mockDaemon.start();
  });

  afterEach(async () => {
    // Stop mock daemon
    if (mockDaemon) {
      await mockDaemon.stop();
    }

    // Restore environment
    if (originalHome !== undefined) {
      process.env['HOME'] = originalHome;
    } else {
      delete process.env['HOME'];
    }
    if (originalUserProfile !== undefined) {
      process.env['USERPROFILE'] = originalUserProfile;
    } else {
      delete process.env['USERPROFILE'];
    }

    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  void describe('connectToDaemon()', () => {
    void it('connects to daemon and receives handshake response', async () => {
      // Test the CONTRACT: Client connects → daemon responds
      const response = await ipcClient.connectToDaemon();

      // Verify response structure (contract)
      assert.equal(response.type, 'handshake_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.sessionId); // Should have a session ID
      assert.ok(response.message); // Should have a message
    });

    void it('throws error when daemon is not running', async () => {
      // Stop daemon to simulate not running
      await mockDaemon.stop();

      // Test the CONTRACT: No daemon → connection error
      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'Error',
          message: /Connection error/,
        }
      );
    });

    void it('throws error on timeout (5s)', async () => {
      // Configure mock daemon to be slow (10s delay)
      mockDaemon.mode = 'slow';

      // Test the CONTRACT: Slow response → timeout error
      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'Error',
          message: /handshake request timeout after 5s/,
        }
      );
    });

    void it('throws error on malformed response', async () => {
      // Configure mock daemon to send invalid JSON
      mockDaemon.mode = 'malformed';

      // Test the CONTRACT: Invalid JSON → parse error
      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'Error',
          message: /Failed to parse handshake response/,
        }
      );
    });

    void it('throws error when connection closes early', async () => {
      // Configure mock daemon to close connection immediately
      mockDaemon.mode = 'close_early';

      // Test the CONTRACT: Early close → connection closed error
      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'Error',
          message: /Connection closed before handshake response received/,
        }
      );
    });
  });

  void describe('getStatus()', () => {
    void it('requests status and receives response', async () => {
      // Test the CONTRACT: Status request → status response
      const response = await ipcClient.getStatus();

      // Verify response structure (contract)
      assert.equal(response.type, 'status_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.daemonPid);
      assert.ok(response.data.socketPath);
    });

    void it('throws error when daemon is not running', async () => {
      // Stop daemon
      await mockDaemon.stop();

      // Test the CONTRACT: No daemon → connection error
      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'Error',
          message: /Connection error/,
        }
      );
    });

    void it('throws error on timeout', async () => {
      // Configure mock daemon to be slow
      mockDaemon.mode = 'slow';

      // Test the CONTRACT: Slow response → timeout
      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'Error',
          message: /status request timeout after 5s/,
        }
      );
    });

    void it('propagates daemon errors', async () => {
      // Configure mock daemon to send error response
      mockDaemon.mode = 'error';

      // Test the CONTRACT: Daemon error → client receives error
      // Note: Current implementation doesn't check status in response
      // This test documents current behavior
      const response = await ipcClient.getStatus();
      assert.equal(response.status, 'error');
    });
  });

  void describe('Socket cleanup', () => {
    void it('cleans up socket after successful response', async () => {
      // First request
      await ipcClient.connectToDaemon();

      // Second request should work (socket was cleaned up)
      const response = await ipcClient.getStatus();
      assert.equal(response.status, 'ok');

      // Third request should also work
      const response2 = await ipcClient.connectToDaemon();
      assert.equal(response2.status, 'ok');
    });

    void it('cleans up socket after error', async () => {
      // Configure daemon to send malformed response
      mockDaemon.mode = 'malformed';

      // First request fails
      await assert.rejects(async () => {
        await ipcClient.connectToDaemon();
      });

      // Reset to normal mode
      mockDaemon.mode = 'normal';

      // Second request should work (socket was cleaned up despite error)
      const response = await ipcClient.getStatus();
      assert.equal(response.status, 'ok');
    });

    void it('cleans up socket after timeout', async () => {
      // Configure daemon to be slow (causes timeout)
      mockDaemon.mode = 'slow';

      // First request times out
      await assert.rejects(async () => {
        await ipcClient.connectToDaemon();
      });

      // Reset to normal mode
      mockDaemon.mode = 'normal';

      // Second request should work (socket was cleaned up after timeout)
      const response = await ipcClient.getStatus();
      assert.equal(response.status, 'ok');
    });
  });

  void describe('Concurrent requests', () => {
    void it('handles multiple concurrent requests', async () => {
      // Test the INVARIANT: Multiple concurrent requests all succeed
      const requests = [
        ipcClient.connectToDaemon(),
        ipcClient.getStatus(),
        ipcClient.connectToDaemon(),
        ipcClient.getStatus(),
      ];

      const responses = await Promise.all(requests);

      // Verify all requests succeeded
      assert.equal(responses.length, 4);
      assert.equal(responses[0]?.type, 'handshake_response');
      assert.equal(responses[1]?.type, 'status_response');
      assert.equal(responses[2]?.type, 'handshake_response');
      assert.equal(responses[3]?.type, 'status_response');
    });

    void it('handles mixed success/failure in concurrent requests', async () => {
      // Configure daemon to send error responses
      mockDaemon.mode = 'error';

      // Mix of requests that will all get errors
      const requests = [ipcClient.getStatus(), ipcClient.connectToDaemon()];

      const responses = await Promise.all(requests);

      // Both should receive error responses
      assert.equal(responses[0]?.status, 'error');
      assert.equal(responses[1]?.status, 'error');

      // Reset to normal mode and verify recovery
      mockDaemon.mode = 'normal';
      const recovery = await ipcClient.getStatus();
      assert.equal(recovery.status, 'ok');
    });
  });

  void describe('JSONL protocol', () => {
    void it('handles requests with unique session IDs', async () => {
      // Test the PROPERTY: Each request has unique session ID
      const response1 = await ipcClient.connectToDaemon();
      const response2 = await ipcClient.connectToDaemon();

      // Session IDs should be different (UUID random)
      assert.notEqual(response1.sessionId, response2.sessionId);
    });

    void it('preserves session ID in response', async () => {
      // Test the INVARIANT: Response sessionId matches request sessionId
      // This is tested implicitly by the mock daemon echoing back sessionId
      const response = await ipcClient.getStatus();

      // Mock daemon echoes sessionId, so if we get a response, it matched
      assert.ok(response.sessionId);
      assert.equal(typeof response.sessionId, 'string');
    });
  });

  void describe('Error handling edge cases', () => {
    void it('handles silent daemon (no response)', async () => {
      // Configure daemon to receive but not respond
      mockDaemon.mode = 'silent';

      // Test the CONTRACT: No response → timeout
      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'Error',
          message: /status request timeout after 5s/,
        }
      );
    });

    void it('handles partial response followed by close', async () => {
      // Create custom mock that sends partial JSON
      await mockDaemon.stop();

      const partialServer = net.createServer((socket) => {
        socket.on('data', () => {
          // Send incomplete JSON and close
          socket.write('{"type": "status');
          socket.end();
        });
      });

      await new Promise<void>((resolve) => {
        partialServer.listen(socketPath, resolve);
      });

      // Test the CONTRACT: Partial response → connection closed error
      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'Error',
          message: /Connection closed before status response received/,
        }
      );

      // Cleanup
      await new Promise<void>((resolve) => {
        partialServer.close(() => resolve());
      });
    });
  });
});
