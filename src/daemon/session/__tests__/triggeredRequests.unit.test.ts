/**
 * Interactions report the network requests that started while they ran.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createInteractionRunner } from '@/daemon/session/interactions.js';
import { toTriggeredRequest, watchTriggeredRequests } from '@/daemon/session/triggeredRequests.js';
import type { NetworkRequest } from '@/types.js';

/** CDP stub answering every call with an empty result. */
const cdp = { send: () => Promise.resolve({}) } as unknown as CDPConnection;

/**
 * Build a captured request.
 *
 * @param requestId - Request id
 * @param fields - Fields to set
 * @returns Request
 */
function request(requestId: string, fields: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId,
    url: `http://127.0.0.1:8080/${requestId}`,
    method: 'GET',
    timestamp: Date.now(),
    ...fields,
  };
}

/**
 * Store with network telemetry on and one request from before the action.
 *
 * @returns Store
 */
function networkStore(): TelemetryStore {
  const store = new TelemetryStore();
  store.activeTelemetry = ['network'];
  store.networkRequests.push(request('before', { timestamp: Date.now() - 1000, status: 200 }));
  return store;
}

void describe('watchTriggeredRequests', () => {
  void it('lists requests started during the action, finished and pending, in start order', () => {
    const store = networkStore();
    const startedEarlier = request('earlier', { timestamp: Date.now() - 500 });
    store.pendingNetworkRequests.set('earlier', { request: startedEarlier, timestamp: 0 });
    const collect = watchTriggeredRequests(store);

    const now = Date.now();
    store.pendingNetworkRequests.set('slow', {
      request: request('slow', { timestamp: now + 1 }),
      timestamp: now,
    });
    store.networkRequests.push(
      request('api', { method: 'POST', timestamp: now + 2, status: 201, duration: 12 }),
      request('fast', { timestamp: now, status: 200, duration: 3 }),
      { ...startedEarlier, status: 200, duration: 600 }
    );

    assert.deepEqual(collect()?.triggeredRequests, [
      {
        requestId: 'fast',
        method: 'GET',
        url: 'http://127.0.0.1:8080/fast',
        status: 200,
        durationMs: 3,
      },
      { requestId: 'slow', method: 'GET', url: 'http://127.0.0.1:8080/slow', pending: true },
      {
        requestId: 'api',
        method: 'POST',
        url: 'http://127.0.0.1:8080/api',
        status: 201,
        durationMs: 12,
      },
    ]);
  });

  void it('orders requests started in the same millisecond by Chrome start time', () => {
    const store = networkStore();
    const collect = watchTriggeredRequests(store);
    const now = Date.now();
    store.pendingNetworkRequests.set('second', {
      request: request('second', { timestamp: now, sentTime: 10.002 }),
      timestamp: now,
    });
    store.networkRequests.push(request('third', { timestamp: now, sentTime: 10.003, status: 200 }));
    store.networkRequests.push(request('first', { timestamp: now, sentTime: 10.001, status: 200 }));
    assert.deepEqual(
      collect()?.triggeredRequests.map((r) => r.requestId),
      ['first', 'second', 'third']
    );
  });

  void it('leaves out data:, blob: and CORS preflight requests', () => {
    const store = networkStore();
    const collect = watchTriggeredRequests(store);
    store.networkRequests.push(
      request('data', { url: 'data:image/png;base64,AAAA', status: 200 }),
      request('blob', { url: 'blob:http://127.0.0.1:8080/1', status: 200 }),
      request('preflight', { method: 'OPTIONS', resourceType: 'Preflight', status: 204 }),
      request('real', { status: 200 })
    );
    assert.deepEqual(
      collect()?.triggeredRequests.map((r) => r.requestId),
      ['real']
    );
  });

  void it('returns an empty list when nothing started, and nothing when network telemetry is off', () => {
    assert.deepEqual(watchTriggeredRequests(networkStore())(), { triggeredRequests: [] });
    const store = new TelemetryStore();
    store.activeTelemetry = ['console'];
    assert.equal(watchTriggeredRequests(store)(), undefined);
  });
});

void describe('watchTriggeredRequests streams and WebSockets', () => {
  void it('marks a request whose response arrived but whose body still loads', () => {
    const store = networkStore();
    const collect = watchTriggeredRequests(store);
    store.pendingNetworkRequests.set('sse', {
      request: request('sse', { status: 200 }),
      timestamp: Date.now(),
    });
    assert.deepEqual(collect()?.triggeredRequests, [
      {
        requestId: 'sse',
        method: 'GET',
        url: 'http://127.0.0.1:8080/sse',
        status: 200,
        loading: true,
      },
    ]);
  });

  void it('lists WebSocket connections opened during the action by their handshake', () => {
    const store = networkStore();
    store.websocketConnections.push({
      requestId: 'old',
      url: 'ws://127.0.0.1:8080/old',
      timestamp: Date.now() - 1000,
      status: 101,
      frames: [],
    });
    const collect = watchTriggeredRequests(store);
    const now = Date.now();
    store.websocketConnections.push(
      { requestId: 'open', url: 'ws://127.0.0.1:8080/ws', timestamp: now, status: 101, frames: [] },
      { requestId: 'connecting', url: 'ws://127.0.0.1:8080/slow', timestamp: now, frames: [] },
      {
        requestId: 'refused',
        url: 'ws://127.0.0.1:1/ws',
        timestamp: now,
        closedTime: now,
        frames: [],
      }
    );
    assert.deepEqual(collect()?.triggeredRequests, [
      { requestId: 'open', method: 'GET', url: 'ws://127.0.0.1:8080/ws', status: 101 },
      { requestId: 'connecting', method: 'GET', url: 'ws://127.0.0.1:8080/slow', pending: true },
      { requestId: 'refused', method: 'GET', url: 'ws://127.0.0.1:1/ws', failed: true },
    ]);
  });
});

void describe('toTriggeredRequest', () => {
  void it('marks requests that failed without a response, keeping why', () => {
    assert.deepEqual(
      toTriggeredRequest(
        request('x', { status: 0, duration: 4, errorText: 'net::ERR_CONNECTION_REFUSED' })
      ),
      {
        requestId: 'x',
        method: 'GET',
        url: 'http://127.0.0.1:8080/x',
        durationMs: 4,
        failed: true,
        errorText: 'net::ERR_CONNECTION_REFUSED',
      }
    );
  });

  void it('keeps the status of a response whose body Chrome stopped reading', () => {
    const entry = toTriggeredRequest(
      request('x', { status: 204, duration: 4, errorText: 'net::ERR_ABORTED' })
    );
    assert.equal(entry.status, 204);
    assert.equal(entry.errorText, undefined);
    assert.equal(entry.failed, undefined);
  });
});

void describe('createInteractionRunner triggered requests', () => {
  void it('adds the requests the action started to its result', async () => {
    const store = networkStore();
    const interact = createInteractionRunner(store);

    const result = await interact(cdp, () => {
      store.networkRequests.push(request('api', { status: 200, duration: 5 }));
      return Promise.resolve({ success: true });
    });

    assert.deepEqual(
      result.triggeredRequests?.map((r) => r.requestId),
      ['api']
    );
  });

  void it('reports nothing when asked not to (page navigation)', async () => {
    const store = networkStore();
    const interact = createInteractionRunner(store);

    const result = await interact(
      cdp,
      () => {
        store.networkRequests.push(request('document', { status: 200 }));
        return Promise.resolve({ success: true });
      },
      { reportRequests: false }
    );

    assert.deepEqual(result, { success: true });
  });
});

void describe('watchTriggeredRequests limit', () => {
  void it('lists the first 50 requests and counts the rest', () => {
    const store = networkStore();
    const collect = watchTriggeredRequests(store);
    for (let i = 0; i < 55; i++) {
      store.networkRequests.push(request(`r${i}`, { status: 200, duration: 1 }));
    }

    const collected = collect();

    assert.equal(collected?.triggeredRequests.length, 50);
    assert.equal(collected?.triggeredRequestsOmitted, 5);
  });
});
