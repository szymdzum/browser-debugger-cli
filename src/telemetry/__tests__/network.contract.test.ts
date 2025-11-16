/**
 * Network telemetry contract tests
 *
 * Tests the public API behavior of startNetworkCollection WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useFakeClock } from '@/__testutils__/testClock.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { startNetworkCollection } from '@/telemetry/network.js';
import type { NetworkRequest } from '@/types';

/**
 * Mock CDP connection for testing network telemetry.
 * Only mocks the CDP boundary - all telemetry logic is real.
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
  on<T>(event: string, handler: (params: T) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Map());
    }
    const id = this.nextHandlerId++;
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.set(id, handler as (params: unknown) => void);
    }
    return () => this.off(event, id);
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

/**
 * Test helper - create minimal Protocol.Network.Request with required fields
 */
function createTestRequest(partial: Partial<Protocol.Network.Request>): Protocol.Network.Request {
  return {
    url: '',
    method: 'GET',
    headers: {},
    initialPriority: 'High',
    referrerPolicy: 'no-referrer-when-downgrade',
    ...partial,
  };
}

/**
 * Test helper - create minimal Protocol.Network.Response with required fields
 */
function createTestResponse(
  partial: Partial<Protocol.Network.Response>
): Protocol.Network.Response {
  return {
    url: '',
    status: 200,
    statusText: 'OK',
    headers: {},
    mimeType: 'text/html',
    charset: 'utf-8',
    connectionReused: false,
    connectionId: 0,
    encodedDataLength: 0,
    securityState: 'secure',
    ...partial,
  };
}

/**
 * Test helper - create partial RequestWillBeSentEvent
 * Tests don't need all fields since the real handlers only use specific ones
 */
function createRequestEvent(
  partial: Partial<Protocol.Network.RequestWillBeSentEvent>
): Protocol.Network.RequestWillBeSentEvent {
  return {
    requestId: '',
    loaderId: '',
    documentURL: '',
    request: createTestRequest({}),
    timestamp: 0,
    wallTime: 0,
    initiator: { type: 'other' },
    redirectHasExtraInfo: false,
    type: 'Other',
    ...partial,
  } as Protocol.Network.RequestWillBeSentEvent;
}

/**
 * Test helper - create partial ResponseReceivedEvent
 * Tests don't need all fields since the real handlers only use specific ones
 */
function createResponseEvent(
  partial: Partial<Protocol.Network.ResponseReceivedEvent>
): Protocol.Network.ResponseReceivedEvent {
  return {
    requestId: '',
    loaderId: '',
    timestamp: 0,
    type: 'Other',
    response: createTestResponse({}),
    hasExtraInfo: false,
    ...partial,
  };
}

void describe('Network telemetry contract', () => {
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
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({
            url: 'https://api.example.com/users',
            method: 'GET',
            headers: { 'User-Agent': 'Test' },
          }),
          timestamp: 1000,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          response: createTestResponse({
            url: 'https://api.example.com/users',
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' },
            mimeType: 'application/json',
          }),
          timestamp: 1050,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1234,
      });

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

      void cleanup();
    });

    void it('should handle multiple concurrent requests', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      for (let i = 1; i <= 3; i++) {
        mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
          'Network.requestWillBeSent',
          createRequestEvent({
            requestId: `req-${i}`,
            request: { url: `https://api.example.com/resource-${i}` } as Protocol.Network.Request,
            timestamp: 1000 + i,
            type: 'XHR',
            frameId: 'frame-1',
            loaderId: 'loader-1',
          })
        );
      }

      for (const i of [3, 1, 2]) {
        mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
          'Network.responseReceived',
          createResponseEvent({
            requestId: `req-${i}`,
            response: {
              url: `https://api.example.com/resource-${i}`,
              mimeType: 'application/json',
            } as Protocol.Network.Response,
            timestamp: 2000 + i,
            type: 'XHR',
            frameId: 'frame-1',
            loaderId: 'loader-1',
          })
        );

        mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
          requestId: `req-${i}`,
          timestamp: 3000 + i,
          encodedDataLength: 100,
        });
      }

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
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          response: createTestResponse({
            url: 'https://api.example.com/users',
            mimeType: 'application/json',
          }),
          timestamp: 1000,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({
            url: 'https://api.example.com/users',
          }),
          timestamp: 1050,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          response: createTestResponse({
            url: 'https://api.example.com/users',
            mimeType: 'application/json',
          }),
          timestamp: 1075,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 100,
      });

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

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({
            url: 'https://api.example.com/fail',
          }),
          timestamp: 1000,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFailedEvent>('Network.loadingFailed', {
        requestId: 'req-1',
        timestamp: 1100,
        type: 'XHR',
        errorText: 'net::ERR_CONNECTION_REFUSED',
      });

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
      const clockHelper = useFakeClock();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'stale-req',
          request: createTestRequest({
            url: 'https://api.example.com/hanging',
          }),
          timestamp: 1000,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      await clockHelper.tickAndFlush(91_000);

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

      for (let i = 1; i <= MAX_REQUESTS + 100; i++) {
        mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
          'Network.requestWillBeSent',
          createRequestEvent({
            requestId: `req-${i}`,
            request: createTestRequest({
              url: `https://api.example.com/item-${i}`,
            }),
            timestamp: 1000 + i,
            type: 'XHR',
            frameId: 'frame-1',
            loaderId: 'loader-1',
          })
        );

        mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
          requestId: `req-${i}`,
          timestamp: 2000 + i,
          encodedDataLength: 100,
        });
      }

      assert.ok(
        requests.length <= MAX_REQUESTS,
        `Should not exceed ${MAX_REQUESTS} requests, got ${requests.length}`
      );

      void cleanup();
    });
  });

  void describe('Cleanup behavior', () => {
    void it('should remove all event handlers on cleanup', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

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

      void cleanup();

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

      void cleanup();
      void cleanup();
      void cleanup();

      assert.equal(mockCDP.getHandlerCount('Network.requestWillBeSent'), 0);
    });
  });

  void describe('Domain filtering', () => {
    void it('should exclude default tracking domains by default', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      const trackingDomains = [
        'https://www.google-analytics.com/collect',
        'https://connect.facebook.net/en_US/fbevents.js',
        'https://www.googletagmanager.com/gtag/js',
      ];

      for (const url of trackingDomains) {
        mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
          'Network.requestWillBeSent',
          createRequestEvent({
            requestId: `req-${url}`,
            request: createTestRequest({ url }),
            timestamp: 1000,
            type: 'Script',
            frameId: 'frame-1',
            loaderId: 'loader-1',
          })
        );

        mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
          requestId: `req-${url}`,
          timestamp: 2000,
          encodedDataLength: 100,
        });
      }

      assert.equal(requests.length, 0, 'Tracking domains should be filtered by default');

      void cleanup();
    });

    void it('should include tracking domains when includeAll=true', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({
            url: 'https://www.google-analytics.com/collect',
          }),
          timestamp: 1000,
          type: 'Script',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 2000,
        encodedDataLength: 100,
      });

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

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({
            url: 'https://api.example.com/data.json',
          }),
          timestamp: 1000,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          response: createTestResponse({
            url: 'https://api.example.com/data.json',
            mimeType: 'application/json',
          }),
          timestamp: 1050,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1024, // 1KB - under limit
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(requests.length, 1);

      void cleanup();
    });

    void it('should skip body for large responses', async () => {
      const cleanup = await startNetworkCollection(
        mockCDP as unknown as CDPConnection,
        requests,
        { maxBodySize: 1024 } // 1KB limit for testing
      );

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({
            url: 'https://api.example.com/large.json',
          }),
          timestamp: 1000,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          response: createTestResponse({
            url: 'https://api.example.com/large.json',
            mimeType: 'application/json',
          }),
          timestamp: 1050,
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 10 * 1024 * 1024, // 10MB - over 1KB limit
      });

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
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      assert.ok(mockCDP.wasNetworkEnabled(), 'Should call Network.enable');

      void cleanup();
    });
  });
});
