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
import type { CleanupFunction } from '@/connection/types.js';
import { startNetworkCollection, startWebSocketCollection } from '@/telemetry/network.js';
import type { NetworkRequest, WebSocketConnection } from '@/types.js';

/**
 * Mock CDP connection for testing network telemetry.
 * Only mocks the CDP boundary - all telemetry logic is real.
 */
class MockCDPConnection {
  private eventHandlers = new Map<
    string,
    Map<number, (params: unknown, sessionId?: string) => void>
  >();
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
  on<T>(event: string, handler: (params: T, sessionId?: string) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Map());
    }
    const id = this.nextHandlerId++;
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.set(id, handler as (params: unknown, sessionId?: string) => void);
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
  emit<T>(event: string, params: T, sessionId?: string): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(params, sessionId));
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
  };
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
      assert.ok((request.duration ?? -1) >= 0, 'Should record how long the request took');

      void cleanup();
    });

    void it("measures durations with Chrome's timestamps and keeps blocked reasons", async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);
      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'fast',
          request: createTestRequest({ url: 'https://a.test/x' }),
          timestamp: 100.0,
        })
      );
      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'fast',
        timestamp: 100.003,
        encodedDataLength: 10,
      });
      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'csp',
          request: createTestRequest({ url: 'https://b.test/y' }),
          timestamp: 200,
        })
      );
      mockCDP.emit<Protocol.Network.LoadingFailedEvent>('Network.loadingFailed', {
        requestId: 'csp',
        timestamp: 200.001,
        type: 'Script',
        errorText: '',
        blockedReason: 'csp',
      });

      assert.equal(requests.find((r) => r.requestId === 'fast')?.duration, 3);
      assert.match(requests.find((r) => r.requestId === 'csp')?.errorText ?? '', /blocked:csp/);
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

  void describe('Resource type capture', () => {
    void it('should capture resourceType from requestWillBeSent when present', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({ url: 'https://example.com/', method: 'GET' }),
          type: 'Document',
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1234,
      });

      assert.equal(requests.length, 1);
      assert.ok(requests[0]);
      assert.equal(requests[0].resourceType, 'Document');

      void cleanup();
    });

    void it('should update resourceType from responseReceived', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-1',
          request: createTestRequest({ url: 'https://api.example.com/data', method: 'GET' }),
          type: 'XHR',
        })
      );

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          type: 'Fetch',
          response: createTestResponse({ status: 200, mimeType: 'application/json' }),
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1234,
      });

      assert.equal(requests.length, 1);
      assert.ok(requests[0]);
      assert.equal(requests[0].resourceType, 'Fetch');

      void cleanup();
    });

    void it('should handle all 19 CDP ResourceType values', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });

      const resourceTypes: Protocol.Network.ResourceType[] = [
        'Document',
        'Stylesheet',
        'Image',
        'Media',
        'Font',
        'Script',
        'TextTrack',
        'XHR',
        'Fetch',
        'Prefetch',
        'EventSource',
        'WebSocket',
        'Manifest',
        'SignedExchange',
        'Ping',
        'CSPViolationReport',
        'Preflight',
        'Other',
      ];

      resourceTypes.forEach((type, index) => {
        mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
          'Network.requestWillBeSent',
          createRequestEvent({
            requestId: `req-${index}`,
            request: createTestRequest({ url: `https://example.com/${index}` }),
            type,
          })
        );
        mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
          requestId: `req-${index}`,
          timestamp: 1100 + index,
          encodedDataLength: 1234,
        });
      });

      assert.equal(requests.length, resourceTypes.length);
      requests.forEach((req, index) => {
        assert.ok(req);
        assert.equal(req.resourceType, resourceTypes[index]);
      });

      void cleanup();
    });

    void it('should handle missing resourceType in requestWillBeSent', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });

      // Emit request without type field (omitted, not undefined)
      const requestEvent = createRequestEvent({
        requestId: 'req-1',
        request: createTestRequest({ url: 'https://example.com/' }),
      });
      // Don't set type field at all to test optional behavior
      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        requestEvent
      );

      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-1',
          type: 'Document',
          response: createTestResponse({ status: 200 }),
        })
      );

      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-1',
        timestamp: 1100,
        encodedDataLength: 1234,
      });

      assert.equal(requests.length, 1);
      assert.ok(requests[0]);
      assert.equal(requests[0].resourceType, 'Document');

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
      assert.ok((request.duration ?? -1) >= 0, 'Failed requests record their duration');

      void cleanup();
    });
  });

  void describe('Edge case: Failure after a response', () => {
    void it('keeps the received status when loading fails afterwards', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-503',
          request: createTestRequest({ url: 'https://api.example.com/unavailable' }),
          timestamp: 1000,
          type: 'Fetch',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );
      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-503',
          response: createTestResponse({ url: 'https://api.example.com/unavailable', status: 503 }),
          timestamp: 1050,
          type: 'Fetch',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );
      mockCDP.emit<Protocol.Network.LoadingFailedEvent>('Network.loadingFailed', {
        requestId: 'req-503',
        timestamp: 1100,
        type: 'Fetch',
        errorText: 'net::ERR_ABORTED',
      });

      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.equal(request.status, 503, 'Received status is not overwritten');
      assert.equal(request.errorText, 'net::ERR_ABORTED');

      void cleanup();
    });
  });

  void describe('Full headers and cache', () => {
    void it('records Cookie, Set-Cookie and cache hits from the extra events', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);

      mockCDP.emit('Network.requestWillBeSentExtraInfo', {
        requestId: 'req-c',
        associatedCookies: [],
        headers: { cookie: 'session=abc' },
        connectTiming: { requestTime: 0 },
      });
      mockCDP.emit<Protocol.Network.RequestWillBeSentEvent>(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'req-c',
          request: createTestRequest({ url: 'https://example.com/account' }),
          timestamp: 1000,
          type: 'Document',
        })
      );
      mockCDP.emit<Protocol.Network.ResponseReceivedEvent>(
        'Network.responseReceived',
        createResponseEvent({
          requestId: 'req-c',
          response: createTestResponse({ url: 'https://example.com/account', headers: {} }),
          timestamp: 1050,
          type: 'Document',
        })
      );
      mockCDP.emit('Network.responseReceivedExtraInfo', {
        requestId: 'req-c',
        blockedCookies: [],
        headers: { 'set-cookie': 'a=1\nb=2' },
        resourceIPAddressSpace: 'Public',
        statusCode: 200,
      });
      mockCDP.emit('Network.requestServedFromCache', { requestId: 'req-c' });
      mockCDP.emit<Protocol.Network.LoadingFinishedEvent>('Network.loadingFinished', {
        requestId: 'req-c',
        timestamp: 1100,
        encodedDataLength: 10,
      });

      const request = requests[0];
      assert.ok(request, 'Request should exist');
      assert.equal(request.requestHeaders?.['cookie'], 'session=abc');
      assert.equal(request.responseHeaders?.['set-cookie'], 'a=1\nb=2');
      assert.equal(request.fromCache, true);

      void cleanup();
    });
  });

  void describe('Long-running and abandoned requests', () => {
    void it('keeps a request that takes minutes until it finishes', async () => {
      const clockHelper = useFakeClock();
      const pendingRequests = new Map();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        pendingRequests,
      });
      mockCDP.emit(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'long-poll',
          request: createTestRequest({ url: 'https://api.example.com/poll' }),
          type: 'XHR',
          frameId: 'frame-1',
          loaderId: 'loader-1',
        })
      );

      await clockHelper.tickAndFlush(5 * 60_000);
      assert.equal(pendingRequests.size, 1, 'still in flight, not dropped');
      mockCDP.emit('Network.loadingFinished', {
        requestId: 'long-poll',
        timestamp: 2,
        encodedDataLength: 10,
      });
      assert.equal(requests[0]?.requestId, 'long-poll');

      void cleanup();
      clockHelper.restore();
    });

    void it('records requests of a replaced document as cancelled', async () => {
      const clockHelper = useFakeClock();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);
      for (const [requestId, frameId, loaderId] of [
        ['old', 'main', 'loader-1'],
        ['frame', 'child', 'loader-9'],
        ['new', 'main', 'loader-2'],
      ] as const) {
        mockCDP.emit(
          'Network.requestWillBeSent',
          createRequestEvent({
            requestId,
            request: createTestRequest({ url: `https://example.com/${requestId}` }),
            type: 'XHR',
            frameId,
            loaderId,
          })
        );
      }

      mockCDP.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'loader-2' } });
      assert.equal(requests.length, 0, 'Chrome gets a moment to report it first');
      await clockHelper.tickAndFlush(6000);

      assert.deepEqual(
        requests.map((r) => [r.requestId, r.status, r.canceled]),
        [['old', 0, true]]
      );
      assert.match(requests[0]?.errorText ?? '', /navigated away/);

      void cleanup();
      clockHelper.restore();
    });

    void it('records requests of a closed iframe or worker as cancelled', async () => {
      const clockHelper = useFakeClock();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests);
      mockCDP.emit(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'w1',
          request: createTestRequest({ url: 'https://example.com/from-worker' }),
          type: 'Fetch',
        }),
        'worker-session'
      );

      mockCDP.emit('Target.detachedFromTarget', { sessionId: 'worker-session' });
      await clockHelper.tickAndFlush(6000);

      assert.equal(requests[0]?.requestId, 'w1');
      assert.match(requests[0]?.errorText ?? '', /went away/);

      void cleanup();
      clockHelper.restore();
    });
  });

  void describe('Request limit enforcement', () => {
    void it('keeps the newest MAX_NETWORK_REQUESTS requests', async () => {
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

      assert.equal(requests.length, MAX_REQUESTS);
      assert.equal(requests[0]?.requestId, 'req-101', 'the oldest are dropped');
      assert.equal(requests.at(-1)?.requestId, `req-${MAX_REQUESTS + 100}`, 'the newest are kept');

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
  void describe('Redirects and in-flight requests', () => {
    void it('keeps every redirect hop as its own entry', async () => {
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
      });
      mockCDP.emit(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'R',
          request: createTestRequest({ url: 'http://example.com/login', method: 'POST' }),
        })
      );
      mockCDP.emit(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'R',
          request: createTestRequest({ url: 'http://example.com/home' }),
          redirectResponse: createTestResponse({
            status: 302,
            headers: { Location: '/home' },
          }),
        })
      );
      mockCDP.emit(
        'Network.responseReceived',
        createResponseEvent({ requestId: 'R', response: createTestResponse({ status: 200 }) })
      );
      mockCDP.emit('Network.loadingFinished', {
        requestId: 'R',
        timestamp: 2,
        encodedDataLength: 10,
      });

      assert.equal(requests.length, 2);
      const [hop, final] = requests;
      assert.equal(hop?.requestId, 'R:redirect:1');
      assert.equal(hop?.method, 'POST');
      assert.equal(hop?.status, 302);
      assert.equal(hop?.redirectURL, 'http://example.com/home');
      assert.equal(final?.requestId, 'R');
      assert.equal(final?.url, 'http://example.com/home');
      assert.equal(final?.status, 200);

      void cleanup();
    });

    void it('never tracks requests excluded by filters', async () => {
      const pendingRequests = new Map();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        networkExclude: ['*/ignored/*'],
        pendingRequests,
      });
      mockCDP.emit(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'X',
          request: createTestRequest({ url: 'http://example.com/ignored/pixel.gif' }),
        })
      );
      assert.equal(pendingRequests.size, 0, 'excluded request must not show up while in flight');
      mockCDP.emit('Network.loadingFinished', {
        requestId: 'X',
        timestamp: 1,
        encodedDataLength: 0,
      });
      assert.equal(requests.length, 0);

      void cleanup();
    });

    void it('exposes in-flight requests through the provided map', async () => {
      const pendingRequests = new Map();
      const cleanup = await startNetworkCollection(mockCDP as unknown as CDPConnection, requests, {
        includeAll: true,
        pendingRequests,
      });
      mockCDP.emit(
        'Network.requestWillBeSent',
        createRequestEvent({
          requestId: 'P',
          request: createTestRequest({ url: 'http://example.com/slow' }),
        })
      );
      assert.equal(pendingRequests.size, 1);
      assert.equal(requests.length, 0);

      mockCDP.emit('Network.loadingFinished', {
        requestId: 'P',
        timestamp: 1,
        encodedDataLength: 0,
      });
      assert.equal(pendingRequests.size, 0);
      assert.equal(requests.length, 1);

      void cleanup();
    });
  });
});

void describe('WebSocket collection', () => {
  let mockCDP: MockCDPConnection;
  let connections: WebSocketConnection[];
  let cleanup: CleanupFunction;

  beforeEach(() => {
    mockCDP = new MockCDPConnection();
    connections = [];
    cleanup = startWebSocketCollection(mockCDP as unknown as CDPConnection, connections);
  });

  afterEach(async () => {
    await cleanup();
  });

  /**
   * Emit a frame event for connection `W`.
   *
   * @param event - Sent or received frame event
   * @param payloadData - Frame payload
   * @param opcode - 1 for text, 2 for binary
   */
  function emitFrame(event: string, payloadData: string, opcode = 1): void {
    mockCDP.emit(event, {
      requestId: 'W',
      timestamp: 1,
      response: { opcode, mask: false, payloadData },
    });
  }

  void it('stores a connection when created and updates it while open', () => {
    mockCDP.emit('Network.webSocketCreated', { requestId: 'W', url: 'ws://example.com/ws' });
    assert.equal(connections.length, 1);

    mockCDP.emit('Network.webSocketWillSendHandshakeRequest', {
      requestId: 'W',
      timestamp: 1,
      wallTime: 1,
      request: { headers: { Upgrade: 'websocket' } },
    });
    mockCDP.emit('Network.webSocketHandshakeResponseReceived', {
      requestId: 'W',
      timestamp: 1,
      response: { status: 101, statusText: 'Switching Protocols', headers: {} },
    });
    emitFrame('Network.webSocketFrameSent', 'hello');
    emitFrame('Network.webSocketFrameReceived', 'world');

    const [connection] = connections;
    assert.equal(connection?.status, 101);
    assert.equal(connection?.statusText, 'Switching Protocols');
    assert.deepEqual(connection?.requestHeaders, { Upgrade: 'websocket' });
    assert.deepEqual(
      connection?.frames.map((f) => [f.direction, f.payloadData]),
      [
        ['sent', 'hello'],
        ['received', 'world'],
      ]
    );
    assert.equal(connection?.closedTime, undefined);

    mockCDP.emit('Network.webSocketClosed', { requestId: 'W', timestamp: 2 });
    assert.equal(connections.length, 1, 'closing does not add the connection again');
    assert.ok(connection?.closedTime);
  });

  void it('truncates oversized payloads, keeping binary ones valid base64', () => {
    mockCDP.emit('Network.webSocketCreated', { requestId: 'W', url: 'ws://example.com/ws' });
    emitFrame('Network.webSocketFrameReceived', 'a'.repeat(200 * 1024));
    emitFrame('Network.webSocketFrameReceived', 'QUJD'.repeat(40 * 1024) + 'QQ==', 2);

    const [text, binary] = connections[0]?.frames ?? [];
    assert.equal(text?.payloadData.length, 100 * 1024);
    assert.equal(text?.truncatedFrom, 200 * 1024);
    assert.equal((binary?.payloadData.length ?? 0) % 4, 0);
    assert.match(binary?.payloadData ?? '', /^[A-Za-z0-9+/]*={0,2}$/);
    assert.equal(binary?.truncatedFrom, 160 * 1024 + 4);
  });

  void it('stops tracking new connections at the limit', () => {
    for (let i = 0; i < 101; i++) {
      mockCDP.emit('Network.webSocketCreated', { requestId: `W${i}`, url: 'ws://example.com/ws' });
    }
    assert.equal(connections.length, 100);
  });
});

void describe('WebSocket connections across navigations', () => {
  void it('closes connections of a page that navigated away', () => {
    const mockCDP = new MockCDPConnection();
    const connections: WebSocketConnection[] = [];
    const cleanup = startWebSocketCollection(mockCDP as unknown as CDPConnection, connections);
    mockCDP.emit('Network.webSocketCreated', { requestId: 'W', url: 'ws://example.com/ws' });

    mockCDP.emit('Page.frameNavigated', {
      frame: { id: 'child', parentId: 'main', loaderId: 'l2' },
    });
    assert.equal(connections[0]?.closedTime, undefined, 'an iframe navigation keeps it');

    mockCDP.emit('Page.frameNavigated', { frame: { id: 'main', loaderId: 'l3' } });
    assert.ok(connections[0]?.closedTime, 'a main-frame navigation ends it');

    void cleanup();
  });
});
