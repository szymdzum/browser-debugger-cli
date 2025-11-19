/**
 * IPC Client Contract Tests
 *
 * Tests the public API behavior of IPC client functions WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
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
} from '@/ipc/index.js';

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
  let originalIpcTimeout: string | undefined;
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

    // Override IPC timeout for faster tests (5 seconds instead of 45)
    originalIpcTimeout = process.env['BDG_IPC_TIMEOUT_MS'];
    process.env['BDG_IPC_TIMEOUT_MS'] = '5000';

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
    if (originalIpcTimeout !== undefined) {
      process.env['BDG_IPC_TIMEOUT_MS'] = originalIpcTimeout;
    } else {
      delete process.env['BDG_IPC_TIMEOUT_MS'];
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
      const response = await ipcClient.connectToDaemon();

      assert.equal(response.type, 'handshake_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.sessionId);
      assert.ok(response.message);
    });

    void it('throws error when daemon is not running', async () => {
      // Stop daemon to simulate not running
      await mockDaemon.stop();

      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'IPCConnectionError',
          message: /IPC handshake connection error/,
        }
      );
    });

    void it('throws error on timeout (5s)', async () => {
      // Configure mock daemon to be slow (10s delay)
      mockDaemon.mode = 'slow';

      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'IPCTimeoutError',
          message: /handshake request timeout after 5s/,
        }
      );
    });

    void it('throws error on malformed response', async () => {
      // Configure mock daemon to send invalid JSON
      mockDaemon.mode = 'malformed';

      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'IPCParseError',
          message: /Failed to parse handshake response/,
        }
      );
    });

    void it('throws error when connection closes early', async () => {
      // Configure mock daemon to close connection immediately
      mockDaemon.mode = 'close_early';

      await assert.rejects(
        async () => {
          await ipcClient.connectToDaemon();
        },
        {
          name: 'IPCEarlyCloseError',
          message: /Connection closed before handshake response received/,
        }
      );
    });
  });

  void describe('getStatus()', () => {
    void it('requests status and receives response', async () => {
      const response = await ipcClient.getStatus();

      assert.equal(response.type, 'status_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.daemonPid);
      assert.ok(response.data.socketPath);
    });

    void it('throws error when daemon is not running', async () => {
      // Stop daemon
      await mockDaemon.stop();

      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'IPCConnectionError',
          message: /IPC status connection error/,
        }
      );
    });

    void it('throws error on timeout', async () => {
      // Configure mock daemon to be slow
      mockDaemon.mode = 'slow';

      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'IPCTimeoutError',
          message: /status request timeout after 5s/,
        }
      );
    });

    void it('propagates daemon errors', async () => {
      // Configure mock daemon to send error response
      mockDaemon.mode = 'error';

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
      const requests = [
        ipcClient.connectToDaemon(),
        ipcClient.getStatus(),
        ipcClient.connectToDaemon(),
        ipcClient.getStatus(),
      ];

      const responses = await Promise.all(requests);

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
      const response1 = await ipcClient.connectToDaemon();
      const response2 = await ipcClient.connectToDaemon();

      // Session IDs should be different (UUID random)
      assert.notEqual(response1.sessionId, response2.sessionId);
    });

    void it('preserves session ID in response', async () => {
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

      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'IPCTimeoutError',
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

      await assert.rejects(
        async () => {
          await ipcClient.getStatus();
        },
        {
          name: 'IPCEarlyCloseError',
          message: /Connection closed before status response received/,
        }
      );

      // Cleanup
      await new Promise<void>((resolve) => {
        partialServer.close(() => resolve());
      });
    });
  });

  void describe('getDetails()', () => {
    void it('fetches network request details by ID', async () => {
      // Create custom mock that responds to worker_details_request
      await mockDaemon.stop();

      const detailsServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string; id: string };
              if (request.type === 'worker_details_request') {
                const response = {
                  type: 'worker_details_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                  data: {
                    item: {
                      requestId: request.id,
                      url: 'https://example.com/api',
                      method: 'GET',
                      status: 200,
                      headers: { 'content-type': 'application/json' },
                    },
                  },
                };
                socket.write(JSON.stringify(response) + '\n');
              }
            }
          }
        });
      });

      await new Promise<void>((resolve) => {
        detailsServer.listen(socketPath, resolve);
      });

      const response = await ipcClient.getDetails('network', 'req-123');

      assert.equal(response.type, 'worker_details_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.item);

      // Cleanup
      await new Promise<void>((resolve) => {
        detailsServer.close(() => resolve());
      });
    });

    void it('fetches console message details by ID', async () => {
      // Create custom mock that responds to worker_details_request
      await mockDaemon.stop();

      const detailsServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string };
              if (request.type === 'worker_details_request') {
                const response = {
                  type: 'worker_details_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                  data: {
                    item: {
                      type: 'log',
                      timestamp: Date.now(),
                      text: 'Test log message',
                      stackTrace: { callFrames: [] },
                    },
                  },
                };
                socket.write(JSON.stringify(response) + '\n');
              }
            }
          }
        });
      });

      await new Promise<void>((resolve) => {
        detailsServer.listen(socketPath, resolve);
      });

      const response = await ipcClient.getDetails('console', 'msg-456');

      assert.equal(response.type, 'worker_details_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.item);

      // Cleanup
      await new Promise<void>((resolve) => {
        detailsServer.close(() => resolve());
      });
    });

    void it('throws error when daemon is not running', async () => {
      // Stop daemon
      await mockDaemon.stop();

      await assert.rejects(
        async () => {
          await ipcClient.getDetails('network', 'req-123');
        },
        {
          name: 'IPCConnectionError',
          message: /IPC worker_details connection error/,
        }
      );
    });
  });

  void describe('callCDP()', () => {
    void it('executes CDP method and returns result', async () => {
      // Create custom mock that responds to cdp_call_request
      await mockDaemon.stop();

      const cdpServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string };
              if (request.type === 'cdp_call_request') {
                const response = {
                  type: 'cdp_call_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                  data: {
                    result: {
                      cookies: [
                        { name: 'session', value: 'abc123' },
                        { name: 'user_id', value: '42' },
                      ],
                    },
                  },
                };
                socket.write(JSON.stringify(response) + '\n');
              }
            }
          }
        });
      });

      await new Promise<void>((resolve) => {
        cdpServer.listen(socketPath, resolve);
      });

      const response = await ipcClient.callCDP('Network.getCookies', {});

      assert.equal(response.type, 'cdp_call_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.result);

      // Cleanup
      await new Promise<void>((resolve) => {
        cdpServer.close(() => resolve());
      });
    });

    void it('forwards CDP method parameters correctly', async () => {
      // Create custom mock that echoes back the method and params
      await mockDaemon.stop();

      type ReceivedRequest = { method: string; params: Record<string, unknown> };
      let receivedRequest: ReceivedRequest | null = null;

      const cdpServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as {
                type: string;
                sessionId: string;
                method: string;
                params: Record<string, unknown>;
              };
              if (request.type === 'cdp_call_request') {
                // Capture the request for verification
                receivedRequest = { method: request.method, params: request.params };

                const response = {
                  type: 'cdp_call_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                  data: {
                    result: { success: true },
                  },
                };
                socket.write(JSON.stringify(response) + '\n');
              }
            }
          }
        });
      });

      await new Promise<void>((resolve) => {
        cdpServer.listen(socketPath, resolve);
      });

      await ipcClient.callCDP('Network.setCookie', {
        name: 'test',
        value: 'value123',
        domain: 'example.com',
      });

      assert.ok(receivedRequest, 'Request should have been received');
      const req = receivedRequest as ReceivedRequest;
      assert.equal(req.method, 'Network.setCookie');
      assert.ok(req.params);
      assert.equal(req.params['name'], 'test');
      assert.equal(req.params['value'], 'value123');
      assert.equal(req.params['domain'], 'example.com');

      // Cleanup
      await new Promise<void>((resolve) => {
        cdpServer.close(() => resolve());
      });
    });

    void it('handles CDP method without parameters', async () => {
      // Create custom mock
      await mockDaemon.stop();

      const cdpServer = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string };
              if (request.type === 'cdp_call_request') {
                const response = {
                  type: 'cdp_call_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                  data: {
                    result: { userAgent: 'Mozilla/5.0' },
                  },
                };
                socket.write(JSON.stringify(response) + '\n');
              }
            }
          }
        });
      });

      await new Promise<void>((resolve) => {
        cdpServer.listen(socketPath, resolve);
      });

      const response = await ipcClient.callCDP('Browser.getVersion');

      assert.equal(response.type, 'cdp_call_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);

      // Cleanup
      await new Promise<void>((resolve) => {
        cdpServer.close(() => resolve());
      });
    });

    void it('throws error when daemon is not running', async () => {
      // Stop daemon
      await mockDaemon.stop();

      await assert.rejects(
        async () => {
          await ipcClient.callCDP('Network.getCookies', {});
        },
        {
          name: 'IPCConnectionError',
          message: /IPC cdp_call connection error/,
        }
      );
    });
  });
});
