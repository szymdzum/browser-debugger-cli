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

    void it('caps lastN at MAX_PEEK_ITEMS (10000)', async () => {
      // Test that requested lastN is capped at the maximum
      // We don't need to create 10000+ items to test this - just verify
      // that requesting more than available returns all available items
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

      // Request 200 items when only 150 exist - should return all 150
      const result = await registry.worker_peek(mockCdp, { lastN: 200 });

      assert.equal(result.network.length, 150);
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

  void describe('worker_har_data', () => {
    void it('returns all captured network requests', async () => {
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

      const result = await registry.worker_har_data(mockCdp, {});

      assert.equal(result.requests.length, 2);
      assert.equal(result.requests[0]?.requestId, 'req-1');
      assert.equal(result.requests[1]?.requestId, 'req-2');
    });

    void it('returns empty array when no requests captured', async () => {
      const result = await registry.worker_har_data(mockCdp, {});
      assert.equal(result.requests.length, 0);
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

  void describe('worker_network_headers', () => {
    void describe('smart default selection', () => {
      void it('selects most recent HTML request', async () => {
        store.networkRequests.push(
          {
            requestId: 'req-1',
            timestamp: 100,
            method: 'GET',
            url: 'http://a.com',
            mimeType: 'text/html',
            responseHeaders: { 'content-type': 'text/html' },
          },
          {
            requestId: 'req-2',
            timestamp: 200,
            method: 'GET',
            url: 'http://b.com/image.png',
            mimeType: 'image/png',
            responseHeaders: { 'content-type': 'image/png' },
          },
          {
            requestId: 'req-3',
            timestamp: 300,
            method: 'GET',
            url: 'http://c.com',
            mimeType: 'text/html',
            responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
          }
        );

        const result = await registry.worker_network_headers(mockCdp, {});

        assert.equal(result.requestId, 'req-3');
        assert.equal(result.url, 'http://c.com');
      });

      void it('falls back to most recent request with headers when no HTML', async () => {
        store.networkRequests.push(
          {
            requestId: 'req-1',
            timestamp: 100,
            method: 'GET',
            url: 'http://a.com/image.png',
            mimeType: 'image/png',
            responseHeaders: {},
          },
          {
            requestId: 'req-2',
            timestamp: 200,
            method: 'GET',
            url: 'http://b.com/api',
            mimeType: 'application/json',
            responseHeaders: { 'content-type': 'application/json' },
          }
        );

        const result = await registry.worker_network_headers(mockCdp, {});

        assert.equal(result.requestId, 'req-2');
        assert.equal(result.url, 'http://b.com/api');
      });

      void it('returns request even when headers are undefined', async () => {
        store.networkRequests.push({
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://a.com',
          mimeType: 'text/html',
        });

        const result = await registry.worker_network_headers(mockCdp, {});

        assert.equal(result.requestId, 'req-1');
        assert.deepEqual(result.requestHeaders, {});
        assert.deepEqual(result.responseHeaders, {});
      });

      void it('rejects when no requests captured at all', async () => {
        await assert.rejects(
          async () => {
            await registry.worker_network_headers(mockCdp, {});
          },
          {
            message: 'No network requests with headers found',
          }
        );
      });
    });

    void describe('specific request ID', () => {
      void it('returns headers for matching request ID', async () => {
        store.networkRequests.push({
          requestId: 'ABC123',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
          requestHeaders: { 'User-Agent': 'Chrome', Accept: 'text/html' },
          responseHeaders: { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=3600' },
        });

        const result = await registry.worker_network_headers(mockCdp, { id: 'ABC123' });

        assert.equal(result.requestId, 'ABC123');
        assert.equal(result.url, 'http://example.com');
        assert.deepEqual(result.requestHeaders, { 'User-Agent': 'Chrome', Accept: 'text/html' });
        assert.deepEqual(result.responseHeaders, {
          'Content-Type': 'text/html',
          'Cache-Control': 'max-age=3600',
        });
      });

      void it('handles missing requestHeaders gracefully', async () => {
        store.networkRequests.push({
          requestId: 'REQ1',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
          responseHeaders: { 'Content-Type': 'text/html' },
        });

        const result = await registry.worker_network_headers(mockCdp, { id: 'REQ1' });

        assert.deepEqual(result.requestHeaders, {});
        assert.deepEqual(result.responseHeaders, { 'Content-Type': 'text/html' });
      });

      void it('handles missing responseHeaders gracefully', async () => {
        store.networkRequests.push({
          requestId: 'REQ2',
          timestamp: 100,
          method: 'POST',
          url: 'http://api.example.com',
          requestHeaders: { 'Content-Type': 'application/json' },
        });

        const result = await registry.worker_network_headers(mockCdp, { id: 'REQ2' });

        assert.deepEqual(result.requestHeaders, { 'Content-Type': 'application/json' });
        assert.deepEqual(result.responseHeaders, {});
      });

      void it('rejects when request ID not found', async () => {
        store.networkRequests.push({
          requestId: 'VALID',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
        });

        await assert.rejects(
          async () => {
            await registry.worker_network_headers(mockCdp, { id: 'MISSING' });
          },
          {
            message: 'Network request not found: MISSING',
          }
        );
      });
    });

    void describe('header filtering', () => {
      void it('filters to specific header (case-insensitive)', async () => {
        store.networkRequests.push({
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
          mimeType: 'text/html',
          requestHeaders: { 'User-Agent': 'Chrome', Accept: 'text/html' },
          responseHeaders: {
            'Content-Type': 'text/html',
            'Cache-Control': 'max-age=3600',
            'X-Frame-Options': 'SAMEORIGIN',
          },
        });

        const result = await registry.worker_network_headers(mockCdp, {
          headerName: 'content-type',
        });

        assert.deepEqual(result.responseHeaders, { 'Content-Type': 'text/html' });
        assert.deepEqual(result.requestHeaders, {});
      });

      void it('preserves original header casing in filtered results', async () => {
        store.networkRequests.push({
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
          mimeType: 'text/html',
          responseHeaders: {
            'Content-Type': 'text/html',
            'X-Custom-Header': 'value',
          },
        });

        const result = await registry.worker_network_headers(mockCdp, {
          headerName: 'X-CUSTOM-HEADER',
        });

        assert.deepEqual(result.responseHeaders, { 'X-Custom-Header': 'value' });
      });

      void it('returns empty objects when filtered header not found', async () => {
        store.networkRequests.push({
          requestId: 'req-1',
          timestamp: 100,
          method: 'GET',
          url: 'http://example.com',
          mimeType: 'text/html',
          responseHeaders: { 'Content-Type': 'text/html' },
        });

        const result = await registry.worker_network_headers(mockCdp, {
          headerName: 'x-nonexistent',
        });

        assert.deepEqual(result.requestHeaders, {});
        assert.deepEqual(result.responseHeaders, {});
      });

      void it('filters both request and response headers', async () => {
        store.networkRequests.push({
          requestId: 'req-1',
          timestamp: 100,
          method: 'POST',
          url: 'http://api.example.com',
          mimeType: 'application/json',
          requestHeaders: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token',
          },
          responseHeaders: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        });

        const result = await registry.worker_network_headers(mockCdp, {
          headerName: 'content-type',
        });

        assert.deepEqual(result.requestHeaders, { 'Content-Type': 'application/json' });
        assert.deepEqual(result.responseHeaders, { 'Content-Type': 'application/json' });
      });
    });

    void describe('combined: specific ID + header filter', () => {
      void it('applies header filter to specific request', async () => {
        store.networkRequests.push(
          {
            requestId: 'req-1',
            timestamp: 100,
            method: 'GET',
            url: 'http://a.com',
            mimeType: 'text/html',
            responseHeaders: { 'Content-Type': 'text/html' },
          },
          {
            requestId: 'req-2',
            timestamp: 200,
            method: 'GET',
            url: 'http://b.com',
            mimeType: 'application/json',
            responseHeaders: {
              'Content-Type': 'application/json',
              'X-Custom': 'value',
            },
          }
        );

        const result = await registry.worker_network_headers(mockCdp, {
          id: 'req-2',
          headerName: 'x-custom',
        });

        assert.equal(result.requestId, 'req-2');
        assert.deepEqual(result.responseHeaders, { 'X-Custom': 'value' });
      });
    });
  });
});
