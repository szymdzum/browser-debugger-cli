/**
 * Contract tests for CommandRegistry
 *
 * Tests the contract: process worker commands, return correct data structures.
 * Focus on: business logic, error cases, data filtering, index bounds.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/worker/TelemetryStore.js';
import { createCommandRegistry } from '@/daemon/worker/commandRegistry.js';
import type { CommandRegistry } from '@/daemon/worker/commandRegistry.js';
import type { ConsoleMessage, NetworkRequest } from '@/types';
import { VERSION } from '@/utils/version.js';

void describe('CommandRegistry', () => {
  let store: TelemetryStore;
  let registry: CommandRegistry;
  let mockCdp: CDPConnection;

  beforeEach(() => {
    store = new TelemetryStore();
    registry = createCommandRegistry(store);

    // Minimal CDP mock (we don't test CDP interaction here)
    mockCdp = {
      send: () => Promise.resolve({}),
    } as unknown as CDPConnection;
  });

  void describe('worker_peek', () => {
    void it('returns recent network and console data', async () => {
      store.networkRequests.push(
        {
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
          status: 200,
          mimeType: 'text/html',
        },
        {
          requestId: 'req-2',
          timestamp: 200,
          method: 'POST',
          url: 'http://api.example.com',
          status: 201,
          mimeType: 'application/json',
        }
      );

      store.consoleMessages.push(
        { timestamp: 100, type: 'log', text: 'Message 1', args: [] },
        { timestamp: 200, type: 'error', text: 'Message 2', args: [] }
      );

      store.setTargetInfo({
        id: 'target-1',
        type: 'page',
        url: 'http://example.com',
        title: 'Example',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
      });

      const result = await registry.worker_peek(mockCdp, { lastN: 10 });

      assert.equal(result.version, VERSION);
      assert.equal(result.target.url, 'http://example.com');
      assert.equal(result.network.length, 2);
      assert.equal(result.console.length, 2);
    });

    void it('limits results to lastN parameter', async () => {
      // Add 20 network requests
      for (let i = 0; i < 20; i++) {
        store.networkRequests.push({
          requestId: `req-${i}`,
          timestamp: i * 100,
          method: 'GET',
          url: `http://example.com/${i}`,
          status: 200,
          mimeType: 'text/html',
        });
      }

      const result = await registry.worker_peek(mockCdp, { lastN: 5 });

      assert.equal(result.network.length, 5);
      // Should return last 5 (indices 15-19)
      assert.equal(result.network[0]?.url, 'http://example.com/15');
      assert.equal(result.network[4]?.url, 'http://example.com/19');
    });

    void it('defaults to last 10 items when lastN not specified', async () => {
      for (let i = 0; i < 15; i++) {
        store.networkRequests.push({
          requestId: `req-${i}`,
          timestamp: i * 100,
          method: 'GET',
          url: `http://example.com/${i}`,
          status: 200,
          mimeType: 'text/html',
        });
      }

      const result = await registry.worker_peek(mockCdp, {});

      assert.equal(result.network.length, 10);
    });

    void it('caps lastN at 100', async () => {
      for (let i = 0; i < 150; i++) {
        store.networkRequests.push({
          requestId: `req-${i}`,
          timestamp: i * 100,
          method: 'GET',
          url: `http://example.com/${i}`,
          status: 200,
          mimeType: 'text/html',
        });
      }

      const result = await registry.worker_peek(mockCdp, { lastN: 200 });

      assert.equal(result.network.length, 100);
    });

    void it('filters network data to essential fields', async () => {
      const fullRequest: NetworkRequest = {
        requestId: 'req-1',
        timestamp: 100,
        method: 'GET',
        url: 'http://example.com',
        status: 200,
        mimeType: 'text/html',
        requestHeaders: { Accept: '*/*' },
        responseHeaders: { 'Content-Type': 'text/html' },
        responseBody: 'some body',
      };

      store.networkRequests.push(fullRequest);

      const result = await registry.worker_peek(mockCdp, { lastN: 10 });

      const peeked = result.network[0];
      assert.ok(peeked);

      // Should only include essential fields
      assert.equal(peeked.requestId, 'req-1');
      assert.equal(peeked.timestamp, 100);
      assert.equal(peeked.method, 'GET');
      assert.equal(peeked.url, 'http://example.com');
      assert.equal(peeked.status, 200);
      assert.equal(peeked.mimeType, 'text/html');

      // Should NOT include these fields
      assert.equal('requestHeaders' in peeked, false);
      assert.equal('responseHeaders' in peeked, false);
      assert.equal('responseBody' in peeked, false);
    });

    void it('includes activeTelemetry from store', async () => {
      store.activeTelemetry = ['network', 'console'];

      const result = await registry.worker_peek(mockCdp, { lastN: 10 });

      assert.deepEqual(result.activeTelemetry, ['network', 'console']);
    });

    void it('calculates duration correctly', async () => {
      store.sessionStartTime = Date.now() - 5000; // 5 seconds ago

      const result = await registry.worker_peek(mockCdp, { lastN: 10 });

      assert.ok(result.duration >= 5000);
      assert.ok(result.duration < 6000);
    });
  });

  void describe('worker_details - network', () => {
    void it('returns full network request by ID', async () => {
      const request: NetworkRequest = {
        requestId: 'req-1',
        timestamp: 100,
        method: 'GET',
        url: 'http://example.com',
        status: 200,
        mimeType: 'text/html',
        responseHeaders: { 'Content-Type': 'text/html' },
        responseBody: 'Full body content',
      };

      store.networkRequests.push(request);

      const result = await registry.worker_details(mockCdp, {
        itemType: 'network',
        id: 'req-1',
      });

      assert.deepEqual(result.item, request);
    });

    void it('rejects when network request not found', async () => {
      await assert.rejects(
        async () => {
          await registry.worker_details(mockCdp, {
            itemType: 'network',
            id: 'non-existent',
          });
        },
        {
          message: 'Network request not found: non-existent',
        }
      );
    });

    void it('finds request among multiple', async () => {
      store.networkRequests.push(
        {
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://a.com',
          status: 200,
          mimeType: 'text/html',
        },
        {
          requestId: 'req-2',
          timestamp: 200,
          method: 'POST',
          url: 'http://b.com',
          status: 201,
          mimeType: 'application/json',
        },
        {
          requestId: 'req-3',
          timestamp: 300,
          method: 'GET',
          url: 'http://c.com',
          status: 404,
          mimeType: 'text/html',
        }
      );

      const result = await registry.worker_details(mockCdp, {
        itemType: 'network',
        id: 'req-2',
      });

      assert.equal((result.item as NetworkRequest).requestId, 'req-2');
      assert.equal((result.item as NetworkRequest).url, 'http://b.com');
    });
  });

  void describe('worker_details - console', () => {
    void it('returns console message by index', async () => {
      const message: ConsoleMessage = {
        timestamp: 100,
        type: 'log',
        text: 'Test message',
        args: [{ type: 'string', value: 'test' }],
      };

      store.consoleMessages.push(message);

      const result = await registry.worker_details(mockCdp, {
        itemType: 'console',
        id: '0',
      });

      assert.deepEqual(result.item, message);
    });

    void it('rejects when console index is invalid number', async () => {
      store.consoleMessages.push({
        timestamp: 100,
        type: 'log',
        text: 'Message',
        args: [],
      });

      await assert.rejects(
        async () => {
          await registry.worker_details(mockCdp, {
            itemType: 'console',
            id: 'not-a-number',
          });
        },
        {
          message: /Console message not found at index/,
        }
      );
    });

    void it('rejects when console index is negative', async () => {
      store.consoleMessages.push({
        timestamp: 100,
        type: 'log',
        text: 'Message',
        args: [],
      });

      await assert.rejects(
        async () => {
          await registry.worker_details(mockCdp, {
            itemType: 'console',
            id: '-1',
          });
        },
        {
          message: /Console message not found at index/,
        }
      );
    });

    void it('rejects when console index out of bounds', async () => {
      store.consoleMessages.push(
        { timestamp: 100, type: 'log', text: 'Message 1', args: [] },
        { timestamp: 200, type: 'log', text: 'Message 2', args: [] }
      );

      await assert.rejects(
        async () => {
          await registry.worker_details(mockCdp, {
            itemType: 'console',
            id: '5',
          });
        },
        {
          message: 'Console message not found at index: 5 (available: 0-1)',
        }
      );
    });

    void it('finds message at correct index among multiple', async () => {
      store.consoleMessages.push(
        { timestamp: 100, type: 'log', text: 'First', args: [] },
        { timestamp: 200, type: 'error', text: 'Second', args: [] },
        { timestamp: 300, type: 'warning', text: 'Third', args: [] }
      );

      const result = await registry.worker_details(mockCdp, {
        itemType: 'console',
        id: '1',
      });

      assert.equal((result.item as ConsoleMessage).text, 'Second');
      assert.equal((result.item as ConsoleMessage).type, 'error');
    });
  });

  void describe('worker_details - error cases', () => {
    void it('rejects with unknown itemType', async () => {
      await assert.rejects(
        async () => {
          await registry.worker_details(mockCdp, {
            itemType: 'unknown' as 'network',
            id: '1',
          });
        },
        {
          message: "Unknown itemType: unknown. Expected 'network' or 'console'.",
        }
      );
    });
  });

  void describe('worker_status', () => {
    void it('returns comprehensive status data', async () => {
      store.sessionStartTime = Date.now() - 10000;
      store.setTargetInfo({
        id: 'target-1',
        type: 'page',
        url: 'http://example.com',
        title: 'Example',
        webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
      });
      store.activeTelemetry = ['network', 'console', 'dom'];

      store.networkRequests.push({
        requestId: 'req-1',
        timestamp: 5000,
        method: 'GET',
        url: 'http://example.com',
        status: 200,
        mimeType: 'text/html',
      });

      store.consoleMessages.push({
        timestamp: 7000,
        type: 'log',
        text: 'Message',
        args: [],
      });

      const result = await registry.worker_status(mockCdp, {});

      assert.equal(result.target.url, 'http://example.com');
      assert.deepEqual(result.activeTelemetry, ['network', 'console', 'dom']);
      assert.equal(result.activity.networkRequestsCaptured, 1);
      assert.equal(result.activity.consoleMessagesCaptured, 1);
      assert.equal(result.activity.lastNetworkRequestAt, 5000);
      assert.equal(result.activity.lastConsoleMessageAt, 7000);
    });

    void it('omits last activity timestamps when no data captured', async () => {
      const result = await registry.worker_status(mockCdp, {});

      assert.equal(result.activity.networkRequestsCaptured, 0);
      assert.equal(result.activity.consoleMessagesCaptured, 0);
      assert.equal('lastNetworkRequestAt' in result.activity, false);
      assert.equal('lastConsoleMessageAt' in result.activity, false);
    });

    void it('includes only last network timestamp', async () => {
      store.networkRequests.push(
        {
          requestId: 'req-1',
          timestamp: 1000,
          method: 'GET',
          url: 'http://a.com',
          status: 200,
          mimeType: 'text/html',
        },
        {
          requestId: 'req-2',
          timestamp: 5000,
          method: 'GET',
          url: 'http://b.com',
          status: 200,
          mimeType: 'text/html',
        }
      );

      const result = await registry.worker_status(mockCdp, {});

      assert.equal(result.activity.lastNetworkRequestAt, 5000);
    });
  });

  void describe('cdp_call', () => {
    void it('forwards CDP method call and returns result', async () => {
      const mockResult = { cookies: [{ name: 'session', value: 'abc123' }] };
      const cdpWithMock = {
        send: (method: string, params: unknown) => {
          assert.equal(method, 'Network.getCookies');
          assert.deepEqual(params, { urls: ['http://example.com'] });
          return Promise.resolve(mockResult);
        },
      } as unknown as CDPConnection;

      const result = await registry.cdp_call(cdpWithMock, {
        method: 'Network.getCookies',
        params: { urls: ['http://example.com'] },
      });

      assert.deepEqual(result.result, mockResult);
    });

    void it('handles CDP call without params', async () => {
      const cdpWithMock = {
        send: (method: string, params: unknown) => {
          assert.equal(method, 'Runtime.enable');
          assert.deepEqual(params, {});
          return Promise.resolve({});
        },
      } as unknown as CDPConnection;

      const result = await registry.cdp_call(cdpWithMock, {
        method: 'Runtime.enable',
      });

      assert.deepEqual(result.result, {});
    });

    void it('propagates CDP errors', async () => {
      const cdpWithError = {
        send: () => {
          return Promise.reject(new Error('CDP connection failed'));
        },
      } as unknown as CDPConnection;

      await assert.rejects(
        async () => {
          await registry.cdp_call(cdpWithError, { method: 'Network.enable' });
        },
        {
          message: 'CDP connection failed',
        }
      );
    });
  });
});
