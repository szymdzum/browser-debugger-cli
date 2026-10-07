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

/** Per-test budget for cases that get an answer (or a refusal) right away */
const FAST_TEST_TIMEOUT_MS = 10_000;

/** Per-test budget for cases that wait out the 5 s IPC timeout */
const SLOW_TEST_TIMEOUT_MS = 20_000;

/** Delay of the slow mock daemon's reply, longer than the 5 s client timeout */
const SLOW_REPLY_DELAY_MS = 10_000;

/** Budget for starting or closing a test server */
const SERVER_LIFECYCLE_TIMEOUT_MS = 3_000;

/** Test options for cases that get an answer right away */
const FAST = { timeout: FAST_TEST_TIMEOUT_MS };

/** Test options for cases that wait out the IPC timeout */
const SLOW = { timeout: SLOW_TEST_TIMEOUT_MS };

/** Servers started by the current test, with the sockets they accepted */
const activeServers = new Map<net.Server, Set<net.Socket>>();

/**
 * Reject when a promise does not settle in time, so no test awaits forever.
 *
 * @param promise - Promise to bound
 * @param ms - Time limit in milliseconds
 * @param label - What is being awaited, used in the error message
 * @returns The promise's value
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start a Unix socket server registered for teardown in afterEach.
 *
 * @param socketPath - Path to listen on (a stale file there is removed)
 * @param onConnection - Handler for each accepted socket
 * @returns The listening server
 */
async function startServer(
  socketPath: string,
  onConnection: (socket: net.Socket) => void
): Promise<net.Server> {
  fs.rmSync(socketPath, { force: true });
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    onConnection(socket);
  });
  activeServers.set(server, sockets);
  const listening = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await withTimeout(listening, SERVER_LIFECYCLE_TIMEOUT_MS, `listen on ${socketPath}`);
  return server;
}

/**
 * Close a server started with startServer, destroying its sockets first so
 * the close never waits on a peer. Closing twice is a no-op.
 *
 * @param server - Server to close
 */
async function closeServer(server: net.Server): Promise<void> {
  const sockets = activeServers.get(server);
  if (!sockets) return;
  activeServers.delete(server);
  for (const socket of sockets) socket.destroy();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await withTimeout(closed, SERVER_LIFECYCLE_TIMEOUT_MS, 'server close');
}

/**
 * Close every server the current test started, whether it passed or failed.
 */
async function closeAllServers(): Promise<void> {
  const results = await Promise.allSettled([...activeServers.keys()].map(closeServer));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/**
 * Mock daemon server that responds to IPC requests.
 * Simulates daemon behavior without starting actual worker processes.
 */
class MockDaemonServer {
  private server: net.Server | null = null;
  private socketPath: string;
  private readonly pendingReplies = new Set<NodeJS.Timeout>();

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
    this.server = await startServer(this.socketPath, (socket) => {
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
          this.delayReply(() => this.sendNormalResponse(socket, request), SLOW_REPLY_DELAY_MS);
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
   * Run a reply later, tracked so stop() can cancel it.
   *
   * @param reply - Reply to send
   * @param delayMs - Delay in milliseconds
   */
  private delayReply(reply: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.pendingReplies.delete(timer);
      reply();
    }, delayMs);
    this.pendingReplies.add(timer);
  }

  /**
   * Stop mock daemon server, cancelling delayed replies and dropping connections
   */
  async stop(): Promise<void> {
    for (const timer of this.pendingReplies) clearTimeout(timer);
    this.pendingReplies.clear();
    const server = this.server;
    this.server = null;
    if (server) await closeServer(server);
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
  }, FAST);

  /**
   * Restore HOME, USERPROFILE and the IPC timeout, then remove the temp directory
   */
  function restoreEnvironment(): void {
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
  }

  afterEach(async () => {
    try {
      await mockDaemon.stop();
      await closeAllServers();
    } finally {
      restoreEnvironment();
    }
  }, FAST);

  void describe('connectToDaemon()', () => {
    void it('connects to daemon and receives handshake response', FAST, async () => {
      const response = await ipcClient.connectToDaemon();

      assert.equal(response.type, 'handshake_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.sessionId);
      assert.ok(response.message);
    });

    void it('throws error when daemon is not running', FAST, async () => {
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

    void it('throws error on timeout (5s)', SLOW, async () => {
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

    void it('throws error on malformed response', FAST, async () => {
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

    void it('throws error when connection closes early', FAST, async () => {
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
    void it('requests status and receives response', FAST, async () => {
      const response = await ipcClient.getStatus();

      assert.equal(response.type, 'status_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.daemonPid);
      assert.ok(response.data.socketPath);
    });

    void it('throws error when daemon is not running', FAST, async () => {
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

    void it('throws error on timeout', SLOW, async () => {
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

    void it('propagates daemon errors', FAST, async () => {
      // Configure mock daemon to send error response
      mockDaemon.mode = 'error';

      // Note: Current implementation doesn't check status in response
      // This test documents current behavior
      const response = await ipcClient.getStatus();
      assert.equal(response.status, 'error');
    });
  });

  void describe('Socket cleanup', () => {
    void it('cleans up socket after successful response', FAST, async () => {
      // First request
      await ipcClient.connectToDaemon();

      // Second request should work (socket was cleaned up)
      const response = await ipcClient.getStatus();
      assert.equal(response.status, 'ok');

      // Third request should also work
      const response2 = await ipcClient.connectToDaemon();
      assert.equal(response2.status, 'ok');
    });

    void it('cleans up socket after error', FAST, async () => {
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

    void it('cleans up socket after timeout', SLOW, async () => {
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
    void it('handles multiple concurrent requests', FAST, async () => {
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

    void it('handles mixed success/failure in concurrent requests', FAST, async () => {
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
    void it('handles requests with unique session IDs', FAST, async () => {
      const response1 = await ipcClient.connectToDaemon();
      const response2 = await ipcClient.connectToDaemon();

      // Session IDs should be different (UUID random)
      assert.notEqual(response1.sessionId, response2.sessionId);
    });

    void it('preserves session ID in response', FAST, async () => {
      // This is tested implicitly by the mock daemon echoing back sessionId
      const response = await ipcClient.getStatus();

      // Mock daemon echoes sessionId, so if we get a response, it matched
      assert.ok(response.sessionId);
      assert.equal(typeof response.sessionId, 'string');
    });
  });

  void describe('Error handling edge cases', () => {
    void it('handles silent daemon (no response)', SLOW, async () => {
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

    void it('handles partial response followed by close', FAST, async () => {
      // Create custom mock that sends partial JSON
      await mockDaemon.stop();

      await startServer(socketPath, (socket) => {
        socket.on('data', () => {
          // Send incomplete JSON and close
          socket.write('{"type": "status');
          socket.end();
        });
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
    });
  });

  void describe('getDetails()', () => {
    void it('fetches network request details by ID', FAST, async () => {
      // Create custom mock that responds to session_details_request
      await mockDaemon.stop();

      await startServer(socketPath, (socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string; id: string };
              if (request.type === 'session_details_request') {
                const response = {
                  type: 'session_details_response',
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

      const response = await ipcClient.getDetails('network', 'req-123');

      assert.equal(response.type, 'session_details_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.item);
    });

    void it('fetches console message details by ID', FAST, async () => {
      // Create custom mock that responds to session_details_request
      await mockDaemon.stop();

      await startServer(socketPath, (socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string };
              if (request.type === 'session_details_request') {
                const response = {
                  type: 'session_details_response',
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

      const response = await ipcClient.getDetails('console', 'msg-456');

      assert.equal(response.type, 'session_details_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.item);
    });

    void it('throws error when daemon is not running', FAST, async () => {
      // Stop daemon
      await mockDaemon.stop();

      await assert.rejects(
        async () => {
          await ipcClient.getDetails('network', 'req-123');
        },
        {
          name: 'IPCConnectionError',
          message: /IPC session_details connection error/,
        }
      );
    });
  });

  void describe('callCDP()', () => {
    void it('executes CDP method and returns result', FAST, async () => {
      // Create custom mock that responds to cdp_call_request
      await mockDaemon.stop();

      await startServer(socketPath, (socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string };
              if (request.type === 'handshake_request') {
                const handshake = {
                  type: 'handshake_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                };
                socket.write(JSON.stringify(handshake) + '\n');
                continue;
              }
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

      const response = await ipcClient.callCDP('Network.getCookies', {});

      assert.equal(response.type, 'cdp_call_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.result);
    });

    void it('forwards CDP method parameters correctly', FAST, async () => {
      // Create custom mock that echoes back the method and params
      await mockDaemon.stop();

      type ReceivedRequest = { method: string; params: Record<string, unknown> };
      let receivedRequest: ReceivedRequest | null = null;

      await startServer(socketPath, (socket) => {
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
              if (request.type === 'handshake_request') {
                const handshake = {
                  type: 'handshake_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                };
                socket.write(JSON.stringify(handshake) + '\n');
                continue;
              }
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
    });

    void it('handles CDP method without parameters', FAST, async () => {
      // Create custom mock
      await mockDaemon.stop();

      await startServer(socketPath, (socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.trim()) {
              const request = JSON.parse(line) as { type: string; sessionId: string };
              if (request.type === 'handshake_request') {
                const handshake = {
                  type: 'handshake_response',
                  sessionId: request.sessionId,
                  status: 'ok',
                };
                socket.write(JSON.stringify(handshake) + '\n');
                continue;
              }
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

      const response = await ipcClient.callCDP('Browser.getVersion');

      assert.equal(response.type, 'cdp_call_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
    });

    void it('throws error when daemon is not running', FAST, async () => {
      // Stop daemon
      await mockDaemon.stop();

      await assert.rejects(
        async () => {
          await ipcClient.callCDP('Network.getCookies', {});
        },
        {
          name: 'IPCConnectionError',
          message: /IPC handshake connection error/,
        }
      );
    });
  });
});
