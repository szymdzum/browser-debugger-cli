/**
 * DOM Eval Command Smoke Tests
 *
 * Provides basic smoke test coverage for DOM eval helpers to verify core functionality.
 * These are lightweight tests that verify the helper functions work as expected without
 * requiring full integration testing with real sessions.
 *
 * Coverage:
 * 1. verifyTargetExists() - CDP target validation
 * 2. executeScript() - JavaScript execution via CDP
 *
 * Note: Session validation functions (validateActiveSession, getValidatedSessionMetadata)
 * are difficult to test in isolation due to ES module import constraints. They are covered
 * by integration tests instead.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { createResponse } from '@/__testfixtures__/cdpMessages.js';
import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { verifyTargetExists, executeScript } from '@/commands/dom/evalHelpers.js';
import { CDPConnection } from '@/connection/cdp.js';
import type { SessionMetadata } from '@/session/metadata.js';

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

    const request = JSON.parse(lastMessage) as { id?: number };
    if (typeof request.id !== 'number') {
      throw new Error('Invalid request ID');
    }

    const response = createResponse(request.id, result);
    this.mockSocket.simulateMessage(JSON.stringify(response));
  }
}

describe('DOM Eval Command Smoke Tests', () => {
  let mockCDP: MockCDPConnection;

  beforeEach(async () => {
    mockCDP = new MockCDPConnection();
    await mockCDP.connectAndOpen();
  });

  afterEach(() => {
    if (mockCDP.isConnected()) {
      mockCDP.close();
    }
    mock.restoreAll();
  });

  describe('verifyTargetExists', () => {
    it('throws error when target not found in CDP list', async () => {
      // Test CONTRACT: Missing target → error

      // Mock fetch to return targets without our targetId
      // eslint-disable-next-line @typescript-eslint/require-await
      globalThis.fetch = mock.fn(async () => {
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          json: async () => [
            { id: 'page-456', type: 'page' },
            { id: 'page-789', type: 'page' },
          ],
        } as Response;
      });

      const metadata: SessionMetadata = {
        bdgPid: 12345,
        startTime: Date.now(),
        port: 9222,
        targetId: 'page-123',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/123',
      };

      await assert.rejects(async () => verifyTargetExists(metadata, 9222), {
        message: /Session target not found/,
      });
    });

    it('succeeds when target exists', async () => {
      // Test CONTRACT: Target exists → no error

      // eslint-disable-next-line @typescript-eslint/require-await
      globalThis.fetch = mock.fn(async () => {
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          json: async () => [
            { id: 'page-123', type: 'page' },
            { id: 'page-456', type: 'page' },
          ],
        } as Response;
      });

      const metadata: SessionMetadata = {
        bdgPid: 12345,
        startTime: Date.now(),
        port: 9222,
        targetId: 'page-123',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/123',
      };

      await assert.doesNotReject(async () => verifyTargetExists(metadata, 9222));
    });

    it('throws error when CDP response is invalid', async () => {
      // Test CONTRACT: Invalid CDP response → error

      // eslint-disable-next-line @typescript-eslint/require-await
      globalThis.fetch = mock.fn(async () => {
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          json: async () => ({ invalid: 'response' }),
        } as Response;
      });

      const metadata: SessionMetadata = {
        bdgPid: 12345,
        startTime: Date.now(),
        port: 9222,
        targetId: 'page-123',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/123',
      };

      await assert.rejects(async () => verifyTargetExists(metadata, 9222), {
        message: /Invalid response from CDP/,
      });
    });
  });

  describe('executeScript', () => {
    it('executes simple JavaScript expression', async () => {
      // Test CONTRACT: Script execution → returns result

      const scriptPromise = executeScript(mockCDP, 'document.title');

      mockCDP.simulateNextResponse({
        result: {
          type: 'string',
          value: 'My Page Title',
        },
      });

      const result = await scriptPromise;

      assert.equal(result.result?.value, 'My Page Title');
    });

    it('executes complex JavaScript expression', async () => {
      // Test CONTRACT: Complex script → returns object result

      const scriptPromise = executeScript(mockCDP, 'window.location.href');

      mockCDP.simulateNextResponse({
        result: {
          type: 'string',
          value: 'https://example.com/page',
        },
      });

      const result = await scriptPromise;

      assert.equal(result.result?.value, 'https://example.com/page');
    });

    it('throws error when script has exception', async () => {
      // Test CONTRACT: Script exception → throws error

      const scriptPromise = executeScript(mockCDP, 'throw new Error("test error")');

      mockCDP.simulateNextResponse({
        exceptionDetails: {
          exception: {
            description: 'Error: test error',
          },
        },
      });

      await assert.rejects(async () => scriptPromise, {
        message: /Error: test error/,
      });
    });

    it('throws error with default message when exception has no description', async () => {
      // Test CONTRACT: Exception without description → default error

      const scriptPromise = executeScript(mockCDP, 'invalid script');

      mockCDP.simulateNextResponse({
        exceptionDetails: {
          exception: {},
        },
      });

      await assert.rejects(async () => scriptPromise, {
        message: /Unknown error executing script/,
      });
    });

    it('handles primitive return values', async () => {
      // Test CONTRACT: Different primitives preserved

      const tests = [
        { script: '42', result: { type: 'number', value: 42 } },
        { script: 'true', result: { type: 'boolean', value: true } },
        { script: '"hello"', result: { type: 'string', value: 'hello' } },
        { script: 'null', result: { type: 'object', subtype: 'null', value: null } },
      ];

      for (const test of tests) {
        const scriptPromise = executeScript(mockCDP, test.script);
        mockCDP.simulateNextResponse({ result: test.result });
        const result = await scriptPromise;

        assert.equal(result.result?.value, test.result.value);
      }
    });

    it('handles object return values', async () => {
      // Test CONTRACT: Objects returned by value

      const scriptPromise = executeScript(
        mockCDP,
        '({ url: "https://example.com", title: "Example" })'
      );

      mockCDP.simulateNextResponse({
        result: {
          type: 'object',
          value: { url: 'https://example.com', title: 'Example' },
        },
      });

      const result = await scriptPromise;

      assert.deepEqual(result.result?.value, {
        url: 'https://example.com',
        title: 'Example',
      });
    });

    it('handles array return values', async () => {
      // Test CONTRACT: Arrays returned by value

      const scriptPromise = executeScript(
        mockCDP,
        'Array.from(document.querySelectorAll("div")).length'
      );

      mockCDP.simulateNextResponse({
        result: {
          type: 'number',
          value: 5,
        },
      });

      const result = await scriptPromise;

      assert.equal(result.result?.value, 5);
    });
  });
});
