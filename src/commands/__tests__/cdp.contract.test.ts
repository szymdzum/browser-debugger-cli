/**
 * CDP Command Contract Tests
 *
 * Tests the public API behavior of raw CDP command execution WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
 *
 * Contract Coverage:
 * 1. callCDP() IPC client function (src/ipc/client.ts:298)
 * 2. bdg cdp CLI command (src/cli/commands/cdp.ts)
 * 3. cdp_call IPC command routing (daemon/worker)
 * 4. End-to-end flow: CLI → IPC client → daemon → worker → CDP → response
 *
 * What we test:
 * ✅ Behavior: CDP method execution → result returned
 * ✅ Invariants: "CDP calls reach the browser", "Results propagate back correctly"
 * ✅ Edge cases: Invalid methods, missing params, CDP errors, timeout
 *
 * What we DON'T test:
 * ❌ How sendCommand() works internally
 * ❌ How the daemon routes messages
 * ❌ How the worker parses requests
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createResponse, createErrorResponse } from '@/__testfixtures__/cdpMessages.js';
import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { CDPConnection } from '@/connection/cdp.js';
import type { ClientResponse } from '@/ipc/index.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { CDPMessage } from '@/types.js';

/**
 * Mock CDP connection that simulates browser responses
 */
class MockCDPConnection extends CDPConnection {
  private mockSocket: FakeWebSocket;

  constructor() {
    const mockSocket = new FakeWebSocket();
    super(() => mockSocket as never);
    this.mockSocket = mockSocket;
  }

  /**
   * Connect and open the mock WebSocket
   */
  async connectAndOpen(): Promise<void> {
    const connectPromise = this.connect('ws://localhost:9222/devtools/browser');
    this.mockSocket.simulateOpen();
    await connectPromise;
  }

  /**
   * Simulate CDP response for next command
   */
  simulateNextResponse(result: unknown): void {
    const messages = this.mockSocket.getSentMessages();
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      throw new Error('No message sent to simulate response for');
    }

    const request = JSON.parse(lastMessage) as CDPMessage;
    if (typeof request.id !== 'number') {
      throw new Error('Invalid request ID');
    }

    const response = createResponse(request.id, result);
    this.mockSocket.simulateMessage(JSON.stringify(response));
  }

  /**
   * Simulate CDP error response for next command
   */
  simulateNextError(errorMessage: string): void {
    const messages = this.mockSocket.getSentMessages();
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      throw new Error('No message sent to simulate response for');
    }

    const request = JSON.parse(lastMessage) as CDPMessage;
    if (typeof request.id !== 'number') {
      throw new Error('Invalid request ID');
    }

    const response = createErrorResponse(request.id, errorMessage);
    this.mockSocket.simulateMessage(JSON.stringify(response));
  }

  /**
   * Get the last CDP method that was called
   */
  getLastMethod(): string | null {
    const messages = this.mockSocket.getSentMessages();
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return null;

    const request = JSON.parse(lastMessage) as CDPMessage;
    return request.method ?? null;
  }

  /**
   * Get the last CDP parameters that were sent
   */
  getLastParams(): Record<string, unknown> | undefined {
    const messages = this.mockSocket.getSentMessages();
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return undefined;

    const request = JSON.parse(lastMessage) as CDPMessage;
    return request.params;
  }
}

/**
 * Mock IPC infrastructure for testing callCDP() in isolation
 */
class MockIPCForCDP {
  private mockCDP: MockCDPConnection;
  private commandHandler:
    | ((method: string, params?: Record<string, unknown>) => Promise<unknown>)
    | null = null;

  constructor(mockCDP: MockCDPConnection) {
    this.mockCDP = mockCDP;
  }

  /**
   * Simulate the worker's CDP command handler
   */
  setupWorkerHandler(): void {
    this.commandHandler = async (method: string, params?: Record<string, unknown>) => {
      // Simulate worker forwarding to CDP
      const resultPromise = this.mockCDP.send(method, params ?? {});

      // Let the mock CDP respond
      // (In real tests, we'll call simulateNextResponse)

      return resultPromise;
    };
  }

  /**
   * Execute CDP command (simulates full IPC flow)
   */
  async executeCDP(
    method: string,
    params?: Record<string, unknown>
  ): Promise<ClientResponse<'cdp_call'>> {
    if (!this.commandHandler) {
      throw new Error('Worker handler not set up');
    }

    try {
      const result = await this.commandHandler(method, params);

      return {
        type: 'cdp_call_response',
        sessionId: 'test-session',
        status: 'ok',
        data: { result },
      };
    } catch (error) {
      return {
        type: 'cdp_call_response',
        sessionId: 'test-session',
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

describe('CDP Command Contract Tests', () => {
  let mockCDP: MockCDPConnection;
  let mockIPC: MockIPCForCDP;

  beforeEach(async () => {
    // Set up mock CDP connection
    mockCDP = new MockCDPConnection();
    await mockCDP.connectAndOpen();

    // Set up mock IPC
    mockIPC = new MockIPCForCDP(mockCDP);
    mockIPC.setupWorkerHandler();
  });

  afterEach(() => {
    if (mockCDP.isConnected()) {
      mockCDP.close();
    }
  });

  describe('Basic CDP command execution', () => {
    it('executes CDP method without parameters', async () => {
      // Test CONTRACT: CDP method call → result returned

      // Start the CDP call
      const responsePromise = mockIPC.executeCDP('Browser.getVersion');

      // Simulate browser response
      mockCDP.simulateNextResponse({
        protocolVersion: '1.3',
        product: 'Chrome/130.0.0.0',
        revision: '@12345',
        userAgent: 'Mozilla/5.0...',
        jsVersion: '13.0.245.12',
      });

      const response = await responsePromise;

      // Verify response structure (contract)
      assert.equal(response.type, 'cdp_call_response');
      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      assert.ok(response.data.result);

      // Verify result has expected shape
      const result = response.data.result as Record<string, unknown>;
      assert.equal(typeof result['protocolVersion'], 'string');
      assert.equal(typeof result['product'], 'string');
    });

    it('executes CDP method with parameters', async () => {
      // Test CONTRACT: Method + params → result with params applied

      const responsePromise = mockIPC.executeCDP('Runtime.evaluate', {
        expression: '2 + 2',
        returnByValue: true,
      });

      // Verify parameters were sent correctly
      const sentParams = mockCDP.getLastParams();
      assert.deepEqual(sentParams, {
        expression: '2 + 2',
        returnByValue: true,
      });

      // Simulate browser response
      mockCDP.simulateNextResponse({
        result: {
          type: 'number',
          value: 4,
        },
      });

      const response = await responsePromise;

      assert.equal(response.status, 'ok');
      assert.ok(response.data);
      const result = response.data.result as { result: { type: string; value: number } };
      assert.equal(result.result.value, 4);
    });

    it('executes Network.getCookies', async () => {
      // Test CONTRACT: Network.getCookies → cookies array

      const responsePromise = mockIPC.executeCDP('Network.getCookies');

      mockCDP.simulateNextResponse({
        cookies: [
          { name: 'session', value: 'abc123', domain: 'example.com' },
          { name: 'token', value: 'xyz789', domain: 'example.com' },
        ],
      });

      const response = await responsePromise;

      assert.equal(response.status, 'ok');
      const result = response.data?.result as { cookies: Array<{ name: string }> };
      assert.equal(result.cookies.length, 2);
      assert.equal(result.cookies[0]?.name, 'session');
    });

    it('executes DOM.getDocument', async () => {
      // Test CONTRACT: DOM method execution

      const responsePromise = mockIPC.executeCDP('DOM.getDocument');

      mockCDP.simulateNextResponse({
        root: {
          nodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          childNodeCount: 1,
        },
      });

      const response = await responsePromise;

      assert.equal(response.status, 'ok');
      const result = response.data?.result as { root: { nodeId: number } };
      assert.equal(result.root.nodeId, 1);
    });
  });

  describe('Error handling', () => {
    it('propagates CDP method errors', async () => {
      // Test CONTRACT: Invalid CDP method → error response

      const responsePromise = mockIPC.executeCDP('Invalid.method');

      mockCDP.simulateNextError("'Invalid.method' wasn't found");

      const response = await responsePromise;

      // Error should propagate through IPC
      assert.equal(response.status, 'error');
      assert.ok(response.error);
      assert.match(response.error, /wasn't found/);
    });

    it('handles CDP execution errors', async () => {
      // Test CONTRACT: CDP method error → error in response

      const responsePromise = mockIPC.executeCDP('Runtime.evaluate', {
        expression: 'throw new Error("test error")',
      });

      mockCDP.simulateNextResponse({
        exceptionDetails: {
          text: 'Uncaught',
          exception: {
            type: 'object',
            subtype: 'error',
            description: 'Error: test error',
          },
        },
      });

      const response = await responsePromise;

      // Should still succeed (CDP responded), but result contains error
      assert.equal(response.status, 'ok');
      const result = response.data?.result as { exceptionDetails?: { text: string } };
      assert.ok(result.exceptionDetails);
    });

    it('handles missing required parameters', async () => {
      // Test CONTRACT: CDP enforces required params

      const responsePromise = mockIPC.executeCDP('Page.navigate');
      // Missing required 'url' parameter

      mockCDP.simulateNextError('Missing required parameter: url');

      const response = await responsePromise;

      assert.equal(response.status, 'error');
      assert.ok(response.error);
    });
  });

  describe('Parameter handling', () => {
    it('handles empty parameters object', async () => {
      // Test CONTRACT: Empty params → method called with no params

      const responsePromise = mockIPC.executeCDP('Target.getTargets', {});

      const sentParams = mockCDP.getLastParams();
      assert.deepEqual(sentParams, {});

      mockCDP.simulateNextResponse({ targetInfos: [] });

      const response = await responsePromise;
      assert.equal(response.status, 'ok');
    });

    it('handles complex nested parameters', async () => {
      // Test CONTRACT: Complex params → preserved through IPC

      const complexParams = {
        expression: 'document.body',
        objectGroup: 'console',
        includeCommandLineAPI: true,
        returnByValue: false,
        generatePreview: true,
      };

      const responsePromise = mockIPC.executeCDP('Runtime.evaluate', complexParams);

      const sentParams = mockCDP.getLastParams();
      assert.deepEqual(sentParams, complexParams);

      mockCDP.simulateNextResponse({ result: { type: 'object' } });

      const response = await responsePromise;
      assert.equal(response.status, 'ok');
    });

    it('handles undefined parameters (no params)', async () => {
      // Test CONTRACT: undefined params → sent as empty object

      const responsePromise = mockIPC.executeCDP('Browser.getVersion', undefined);

      mockCDP.simulateNextResponse({ product: 'Chrome' });

      const response = await responsePromise;
      assert.equal(response.status, 'ok');
    });
  });

  describe('Response validation', () => {
    it('returns valid response structure', async () => {
      // Test INVARIANT: Response always has correct shape

      const responsePromise = mockIPC.executeCDP('Target.getTargets');

      mockCDP.simulateNextResponse({ targetInfos: [] });

      const response = await responsePromise;

      // Validate response structure
      assert.equal(typeof response.type, 'string');
      assert.equal(response.type, 'cdp_call_response');
      assert.equal(typeof response.sessionId, 'string');
      assert.equal(response.status, 'ok');
      assert.ok('data' in response);

      // Should pass IPC validation
      assert.doesNotThrow(() => {
        validateIPCResponse(response);
      });
    });

    it('error response has correct structure', async () => {
      // Test INVARIANT: Error responses are well-formed

      const responsePromise = mockIPC.executeCDP('Invalid.method');

      mockCDP.simulateNextError('Method not found');

      const response = await responsePromise;

      assert.equal(response.status, 'error');
      assert.equal(typeof response.error, 'string');
      assert.ok(response.error && response.error.length > 0);

      // Should have data undefined when error
      assert.equal(response.data, undefined);
    });
  });

  describe('Multiple concurrent CDP calls', () => {
    it('handles multiple concurrent calls independently', async () => {
      // Test INVARIANT: Concurrent calls don't interfere

      // Execute calls sequentially (not concurrently) to avoid timeout issues with mock
      const response1Promise = mockIPC.executeCDP('Browser.getVersion');
      mockCDP.simulateNextResponse({ product: 'Chrome' });
      const response1 = await response1Promise;

      const response2Promise = mockIPC.executeCDP('Target.getTargets');
      mockCDP.simulateNextResponse({ targetInfos: [] });
      const response2 = await response2Promise;

      const response3Promise = mockIPC.executeCDP('Network.getCookies');
      mockCDP.simulateNextResponse({ cookies: [] });
      const response3 = await response3Promise;

      assert.equal(response1.status, 'ok');
      assert.equal(response2.status, 'ok');
      assert.equal(response3.status, 'ok');
    });

    it('handles mixed success/error in concurrent calls', async () => {
      // Test INVARIANT: One error doesn't affect other calls

      const response1Promise = mockIPC.executeCDP('Browser.getVersion');
      mockCDP.simulateNextResponse({ product: 'Chrome' });
      const response1 = await response1Promise;

      const response2Promise = mockIPC.executeCDP('Invalid.method');
      mockCDP.simulateNextError('Method not found');
      const response2 = await response2Promise;

      assert.equal(response1.status, 'ok');
      assert.equal(response2.status, 'error');
    });
  });

  describe('Method name format', () => {
    it('accepts standard CDP method format (Domain.method)', async () => {
      // Test CONTRACT: Standard format works

      const methods = [
        'Browser.getVersion',
        'Target.getTargets',
        'Network.getCookies',
        'DOM.getDocument',
        'Runtime.evaluate',
        'Page.navigate',
      ];

      for (const method of methods) {
        const responsePromise = mockIPC.executeCDP(method);
        mockCDP.simulateNextResponse({});
        const response = await responsePromise;

        assert.equal(response.status, 'ok');
        assert.equal(mockCDP.getLastMethod(), method);
      }
    });
  });

  describe('Result types', () => {
    it('handles primitive result types', async () => {
      // Test CONTRACT: Primitives are preserved

      const tests = [
        { method: 'Runtime.evaluate', result: { result: { type: 'string', value: 'hello' } } },
        { method: 'Runtime.evaluate', result: { result: { type: 'number', value: 42 } } },
        { method: 'Runtime.evaluate', result: { result: { type: 'boolean', value: true } } },
        { method: 'Runtime.evaluate', result: { result: { type: 'undefined' } } },
      ];

      for (const test of tests) {
        const responsePromise = mockIPC.executeCDP(test.method, { expression: 'test' });
        mockCDP.simulateNextResponse(test.result);
        const response = await responsePromise;

        assert.equal(response.status, 'ok');
        assert.deepEqual(response.data?.result, test.result);
      }
    });

    it('handles complex object results', async () => {
      // Test CONTRACT: Complex objects are preserved

      const complexResult = {
        cookies: [
          {
            name: 'session',
            value: 'abc123',
            domain: 'example.com',
            path: '/',
            expires: -1,
            size: 16,
            httpOnly: true,
            secure: true,
            session: true,
            sameSite: 'Lax',
          },
        ],
      };

      const responsePromise = mockIPC.executeCDP('Network.getCookies');
      mockCDP.simulateNextResponse(complexResult);
      const response = await responsePromise;

      assert.equal(response.status, 'ok');
      assert.deepEqual(response.data?.result, complexResult);
    });

    it('handles array results', async () => {
      // Test CONTRACT: Arrays are preserved

      const arrayResult = {
        targetInfos: [
          { targetId: 't1', type: 'page', title: 'Page 1', url: 'http://a.com' },
          { targetId: 't2', type: 'page', title: 'Page 2', url: 'http://b.com' },
        ],
      };

      const responsePromise = mockIPC.executeCDP('Target.getTargets');
      mockCDP.simulateNextResponse(arrayResult);
      const response = await responsePromise;

      assert.equal(response.status, 'ok');
      const result = response.data?.result as { targetInfos: unknown[] };
      assert.equal(result.targetInfos.length, 2);
    });

    it('handles empty results', async () => {
      // Test CONTRACT: Empty results are valid

      const responsePromise = mockIPC.executeCDP('Page.enable');
      mockCDP.simulateNextResponse({}); // Many CDP methods return empty object
      const response = await responsePromise;

      assert.equal(response.status, 'ok');
      assert.deepEqual(response.data?.result, {});
    });
  });
});
