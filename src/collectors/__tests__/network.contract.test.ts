/**
 * Network collector contract tests
 *
 * Tests the public API behavior of startNetworkCollection WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
 *
 * Coverage:
 * 1. Request/response pairing - Normal flow with matching IDs
 * 2. Out-of-order events - Response arrives before request
 * 3. Stale requests - Incomplete requests after timeout
 * 4. Failed requests - Network.loadingFailed events
 * 5. Request limits - MAX_NETWORK_REQUESTS enforcement
 * 6. Cleanup - Handler removal and state cleanup
 * 7. Domain filtering - Tracking/analytics exclusion
 * 8. Body fetching - Size limits and MIME type handling
 *
 * What we test:
 * ✅ Behavior: Given CDP events → expect NetworkRequest array contents
 * ✅ Invariants: "Requests are paired with responses", "Cleanup removes all handlers"
 * ✅ Edge cases: Out-of-order, stale, limits, failures
 *
 * What we DON'T test:
 * ❌ Internal requestMap structure
 * ❌ Internal function calls (tryExactMatch, normalizeUrl, etc.)
 * ❌ Implementation details (Map vs Set, event handler IDs)
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useFakeClock } from '@/__testutils__/testClock.js';
import { startNetworkCollection } from '@/collectors/network.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type {
  CDPNetworkRequestParams,
  CDPNetworkResponseParams,
  CDPNetworkLoadingFinishedParams,
  CDPNetworkLoadingFailedParams,
  NetworkRequest,
} from '@/types';

/**
 * Mock CDP connection for testing network collector.
 * Only mocks the CDP boundary - all collector logic is real.
 */
class MockCDPConnection {
  private eventHandlers = new Map<string, Map<number, (params: unknown) => void>>();
  private nextHandlerId = 0;
  private sendCalls: Array<{ method: string; params?: unknown }> = [];

  /**
   * Mock CDP send - records calls for verification
   */
  send(method: string, params?: unknown): Promise<unknown> {
    this.sendCalls.push({ method, params });
    return Promise.resolve({});
  }

  /**
   * Mock CDP event subscription
   */
  on<T>(event: string, handler: (params: T) => void): number {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Map());
    }
    const id = this.nextHandlerId++;
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.set(id, handler as (params: unknown) => void);
    }
    return id;
  }

  /**
   * Mock CDP event unsubscription
   */
  off(event: string, handlerId: number): void {
    this.eventHandlers.get(event)?.delete(handlerId);
  }

  /**
   * Test helper: Emit CDP event to registered handlers
   */
  emit<T>(event: string, params: T): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(params));
    }
  }

  /**
   * Test helper: Verify Network.enable was called
   */
  wasNetworkEnabled(): boolean {
    return this.sendCalls.some((call) => call.method === 'Network.enable');
  }

  /**
   * Test helper: Get event handler count for verification
   */
  getHandlerCount(event: string): number {
    return this.eventHandlers.get(event)?.size ?? 0;
  }

  /**
   * Test helper: Clear all state
   */
  reset(): void {
    this.eventHandlers.clear();
    this.sendCalls = [];
    this.nextHandlerId = 0;
  }
}

void describe('Network collector contract', () => {
  let mockCDP: MockCDPConnection;
  let requests: NetworkRequest[];

  beforeEach(() => {
    mockCDP = new MockCDPConnection();
    requests = [];
  });

  afterEach(() => {
    void mockCDP.reset();
  });

  void describe('Basic request/response pairing', () => {
    void it('should pair request with response by requestId', async () => {
      // Arrange: Start collection
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Act: Simulate CDP events for a complete request/response cycle
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'req-1',
        request: {
          url: 'https://api.example.com/users',
          method: 'GET',
          headers: { 'User-Agent': 'Test' },
        },
        timestamp: 1000,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkResponseParams>('Network.responseReceived', {
        requestId: 'req-1',
        response: {
          url: 'https://api.example.com/users',
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
          mimeType: 'application/json',
        },
        timestamp: 1050,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1234,
      });

      // Assert: Request is paired with response
      assert.equal(requests.length, 1, 'Should have one network request');
      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.equal(request.requestId, 'req-1');
      assert.equal(request.url, 'https://api.example.com/users');
      assert.equal(request.method, 'GET');
      assert.equal(request.status, 200);
      assert.equal(request.mimeType, 'application/json');
      assert.ok(request.requestHeaders, 'Should have request headers');
      assert.ok(request.responseHeaders, 'Should have response headers');

      // Cleanup
      void cleanup();
    });

    void it('should handle multiple concurrent requests', async () => {
      // Arrange
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Act: Simulate 3 concurrent requests
      for (let i = 1; i <= 3; i++) {
        mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
          requestId: `req-${i}`,
          request: {
            url: `https://api.example.com/resource-${i}`,
            method: 'GET',
            headers: {},
          },
          timestamp: 1000 + i,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        });
      }

      // Responses arrive in different order (3, 1, 2)
      for (const i of [3, 1, 2]) {
        mockCDP.emit<CDPNetworkResponseParams>('Network.responseReceived', {
          requestId: `req-${i}`,
          response: {
            url: `https://api.example.com/resource-${i}`,
            status: 200,
            statusText: 'OK',
            headers: {},
            mimeType: 'application/json',
          },
          timestamp: 2000 + i,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        });

        mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
          requestId: `req-${i}`,
          timestamp: 3000 + i,
          encodedDataLength: 100,
        });
      }

      // Assert: All requests paired correctly despite out-of-order responses
      assert.equal(requests.length, 3);
      assert.ok(requests[0], 'First request should exist');
      assert.ok(requests[1], 'Second request should exist');
      assert.ok(requests[2], 'Third request should exist');
      assert.equal(requests[0].requestId, 'req-3');
      assert.equal(requests[1].requestId, 'req-1');
      assert.equal(requests[2].requestId, 'req-2');

      void cleanup();
    });
  });

  void describe('Edge case: Out-of-order events', () => {
    void it('should handle response arriving before request', async () => {
      // This is a real race condition that can happen in CDP
      // Current behavior: Response event is ignored if request doesn't exist yet
      // The second responseReceived event (after request) sets the status correctly
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Act: Response arrives BEFORE request (early response is ignored)
      mockCDP.emit<CDPNetworkResponseParams>('Network.responseReceived', {
        requestId: 'req-1',
        response: {
          url: 'https://api.example.com/users',
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
        },
        timestamp: 1000,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      // Request arrives later
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'req-1',
        request: {
          url: 'https://api.example.com/users',
          method: 'GET',
          headers: {},
        },
        timestamp: 1050,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      // Response arrives again (normal order) - this one actually sets status
      mockCDP.emit<CDPNetworkResponseParams>('Network.responseReceived', {
        requestId: 'req-1',
        response: {
          url: 'https://api.example.com/users',
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
        },
        timestamp: 1075,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 100,
      });

      // Assert: Request is tracked correctly with response data from second response event
      assert.equal(requests.length, 1, 'Should have one request');
      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.equal(request.status, 200, 'Status should be set from second response event');
      assert.equal(request.url, 'https://api.example.com/users');
      assert.equal(request.mimeType, 'application/json', 'MIME type should be set');

      void cleanup();
    });
  });

  void describe('Edge case: Failed requests', () => {
    void it('should handle Network.loadingFailed events', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Act: Request fails instead of succeeding
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'req-1',
        request: {
          url: 'https://api.example.com/fail',
          method: 'GET',
          headers: {},
        },
        timestamp: 1000,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkLoadingFailedParams>('Network.loadingFailed', {
        requestId: 'req-1',
        timestamp: 1100,
        type: 'XHR',
        errorText: 'net::ERR_CONNECTION_REFUSED',
      });

      // Assert: Failed request is recorded with status 0
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.equal(request.status, 0, 'Failed requests should have status 0');
      assert.equal(request.url, 'https://api.example.com/fail');

      void cleanup();
    });
  });

  void describe('Edge case: Stale request cleanup', () => {
    void it('should clean up stale requests after timeout', async () => {
      // Use fake clock to control time
      const clockHelper = useFakeClock();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Act: Create request but never finish it
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'stale-req',
        request: {
          url: 'https://api.example.com/hanging',
          method: 'GET',
          headers: {},
        },
        timestamp: 1000,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      // Fast-forward past stale timeout (60s) + cleanup interval (30s)
      await clockHelper.tickAndFlush(91_000);

      // Assert: Stale request is NOT in final output (removed from tracking)
      assert.equal(
        requests.length,
        0,
        'Stale requests should not appear in output (removed from tracking)'
      );

      void cleanup();
      clockHelper.restore();
    });
  });

  void describe('Request limit enforcement', () => {
    void it('should enforce MAX_NETWORK_REQUESTS limit', async () => {
      const cleanup = await startNetworkCollection(
        mockCDP as unknown as CDPConnection,
        requests,
        { includeAll: true } // Disable domain filtering for this test
      );

      const MAX_REQUESTS = 10_000;

      // Act: Try to collect more than the limit
      for (let i = 1; i <= MAX_REQUESTS + 100; i++) {
        mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
          requestId: `req-${i}`,
          request: {
            url: `https://api.example.com/item-${i}`,
            method: 'GET',
            headers: {},
          },
          timestamp: 1000 + i,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        });

        mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
          requestId: `req-${i}`,
          timestamp: 2000 + i,
          encodedDataLength: 100,
        });
      }

      // Assert: Should never exceed MAX_NETWORK_REQUESTS
      assert.ok(
        requests.length <= MAX_REQUESTS,
        `Should not exceed ${MAX_REQUESTS} requests, got ${requests.length}`
      );

      void cleanup();
    });
  });

  void describe('Cleanup behavior', () => {
    void it('should remove all event handlers on cleanup', async () => {
      // Arrange
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Assert: Handlers registered during start
      assert.ok(
        mockCDP.getHandlerCount('Network.requestWillBeSent') > 0,
        'Should have requestWillBeSent handler'
      );
      assert.ok(
        mockCDP.getHandlerCount('Network.responseReceived') > 0,
        'Should have responseReceived handler'
      );
      assert.ok(
        mockCDP.getHandlerCount('Network.loadingFinished') > 0,
        'Should have loadingFinished handler'
      );
      assert.ok(
        mockCDP.getHandlerCount('Network.loadingFailed') > 0,
        'Should have loadingFailed handler'
      );

      // Act: Call cleanup
      void cleanup();

      // Assert: All handlers removed
      assert.equal(
        mockCDP.getHandlerCount('Network.requestWillBeSent'),
        0,
        'Should remove requestWillBeSent handler'
      );
      assert.equal(
        mockCDP.getHandlerCount('Network.responseReceived'),
        0,
        'Should remove responseReceived handler'
      );
      assert.equal(
        mockCDP.getHandlerCount('Network.loadingFinished'),
        0,
        'Should remove loadingFinished handler'
      );
      assert.equal(
        mockCDP.getHandlerCount('Network.loadingFailed'),
        0,
        'Should remove loadingFailed handler'
      );
    });

    void it('should be idempotent (safe to call multiple times)', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Act: Call cleanup multiple times
      void cleanup();
      void cleanup();
      void cleanup();

      // Assert: No errors thrown, handlers remain removed
      assert.equal(mockCDP.getHandlerCount('Network.requestWillBeSent'), 0);
    });
  });

  void describe('Domain filtering', () => {
    void it('should exclude default tracking domains by default', async () => {
      const cleanup = await startNetworkCollection(
        mockCDP as unknown as CDPConnection,
        requests
        // includeAll defaults to false
      );

      // Act: Send requests to tracking domains
      const trackingDomains = [
        'https://www.google-analytics.com/collect',
        'https://connect.facebook.net/en_US/fbevents.js',
        'https://www.googletagmanager.com/gtag/js',
      ];

      for (const url of trackingDomains) {
        mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
          requestId: `req-${url}`,
          request: { url, method: 'GET', headers: {} },
          timestamp: 1000,
          type: 'Script',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        });

        mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
          requestId: `req-${url}`,
          timestamp: 2000,
          encodedDataLength: 100,
        });
      }

      // Assert: Tracking requests are filtered out
      assert.equal(requests.length, 0, 'Tracking domains should be filtered by default');

      void cleanup();
    });

    void it('should include tracking domains when includeAll=true', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });

      // Act: Send request to tracking domain
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'req-1',
        request: {
          url: 'https://www.google-analytics.com/collect',
          method: 'GET',
          headers: {},
        },
        timestamp: 1000,
        type: 'Script',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 2000,
        encodedDataLength: 100,
      });

      // Assert: Request included when includeAll=true
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.ok(request.url.includes('google-analytics.com'));

      void cleanup();
    });
  });

  void describe('Response body fetching', () => {
    void it('should fetch body for JSON responses under size limit', async () => {
      const cleanup = await startNetworkCollection(
        mockCDP as unknown as CDPConnection,
        requests,
        { fetchAllBodies: true } // Force fetch all bodies for this test
      );

      // Act: JSON response under 5MB
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'req-1',
        request: {
          url: 'https://api.example.com/data.json',
          method: 'GET',
          headers: {},
        },
        timestamp: 1000,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkResponseParams>('Network.responseReceived', {
        requestId: 'req-1',
        response: {
          url: 'https://api.example.com/data.json',
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
        },
        timestamp: 1050,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1024, // 1KB - under limit
      });

      // Wait for async body fetch
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert: Should attempt to fetch body (mock doesn't actually fetch, but real code would)
      assert.equal(requests.length, 1);

      void cleanup();
    });

    void it('should skip body for large responses', async () => {
      const cleanup = await startNetworkCollection(
        mockCDP as unknown as CDPConnection,
        requests,
        { maxBodySize: 1024 } // 1KB limit for testing
      );

      // Act: JSON response over size limit
      mockCDP.emit<CDPNetworkRequestParams>('Network.requestWillBeSent', {
        requestId: 'req-1',
        request: {
          url: 'https://api.example.com/large.json',
          method: 'GET',
          headers: {},
        },
        timestamp: 1000,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkResponseParams>('Network.responseReceived', {
        requestId: 'req-1',
        response: {
          url: 'https://api.example.com/large.json',
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
        },
        timestamp: 1050,
        type: 'XHR',
        frameId: 'frame-1',
        loaderId: 'loader-1',
      });

      mockCDP.emit<CDPNetworkLoadingFinishedParams>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 10 * 1024 * 1024, // 10MB - over 1KB limit
      });

      // Assert: Body should be marked as skipped
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.ok(
        request.responseBody?.includes('[SKIPPED: Response too large'),
        'Large response should have skip marker'
      );

      void cleanup();
    });
  });

  void describe('Initialization', () => {
    void it('should enable Network domain on start', async () => {
      // Act
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      // Assert: Network.enable was called
      assert.ok(mockCDP.wasNetworkEnabled(), 'Should call Network.enable');

      void cleanup();
    });
  });
});
