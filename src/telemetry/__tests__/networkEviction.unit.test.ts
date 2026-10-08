/**
 * At its limits the network collector keeps the newest requests and bodies:
 * the oldest finished requests are dropped, and the oldest stored bodies are
 * replaced by a placeholder once their total size passes the budget.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { startNetworkCollection } from '@/telemetry/network.js';
import {
  RequestRetention,
  skippedBodyReason,
  type NetworkEvictions,
} from '@/telemetry/networkRetention.js';
import type { NetworkRequest } from '@/types.js';

type Handler = (params: unknown, sessionId?: string) => void;

/**
 * CDP stub: events are emitted by the test, `Network.getResponseBody`
 * answers with the body set for the request.
 */
class FakeCDP {
  readonly bodies = new Map<string, string>();
  private readonly handlers = new Map<string, Set<Handler>>();

  /** Answer `Network.getResponseBody` with the request's body, everything else with `{}` */
  send(method: string, params?: { requestId?: string }): Promise<unknown> {
    if (method !== 'Network.getResponseBody') return Promise.resolve({});
    const body = this.bodies.get(params?.requestId ?? '') ?? '';
    return Promise.resolve({ body, base64Encoded: false });
  }

  /** Subscribe to an event */
  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  /** Remove a handler (unused: `on` returns the remover) */
  off(): void {}

  /** Deliver an event to its handlers */
  emit(event: string, params: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(params));
  }

  /** Start a JSON request (a POST when it has post data) */
  start(requestId: string, postData?: string): void {
    const method = postData === undefined ? 'GET' : 'POST';
    this.emit('Network.requestWillBeSent', {
      requestId,
      loaderId: 'loader',
      frameId: 'frame',
      request: { url: `http://127.0.0.1:8080/${requestId}`, method, headers: {}, postData },
      timestamp: 1,
      type: 'Fetch',
    });
    this.emit('Network.responseReceived', {
      requestId,
      type: 'Fetch',
      response: { url: '', status: 200, headers: {}, mimeType: 'application/json' },
    });
  }

  /** Finish a request (its body, when set, is fetched) */
  finish(requestId: string): void {
    this.emit('Network.loadingFinished', { requestId, timestamp: 2, encodedDataLength: 10 });
  }

  /** Start and finish a request with a body */
  load(requestId: string, body = ''): void {
    this.bodies.set(requestId, body);
    this.start(requestId);
    this.finish(requestId);
  }

  /** Start and finish a POST with post data and a response body */
  post(requestId: string, postData: string, body = ''): void {
    this.bodies.set(requestId, body);
    this.start(requestId, postData);
    this.finish(requestId);
  }
}

/** Let pending body fetches resolve */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Start collecting with small limits.
 *
 * @param limits - Request cap and body budget
 * @returns CDP stub, captured requests and eviction counts
 */
async function collect(limits: { maxRequests?: number; maxTotalBodyBytes?: number }): Promise<{
  cdp: FakeCDP;
  requests: NetworkRequest[];
  evictions: NetworkEvictions;
}> {
  const cdp = new FakeCDP();
  const requests: NetworkRequest[] = [];
  const evictions: NetworkEvictions = { requestsDropped: 0, bodiesEvicted: 0 };
  await startNetworkCollection(cdp as unknown as CDPConnection, requests, {
    includeAll: true,
    evictions,
    ...limits,
  });
  return { cdp, requests, evictions };
}

/**
 * Bytes of the request and response bodies still stored (placeholders aside).
 *
 * @param requests - Captured requests
 * @returns Total stored body bytes
 */
function storedBodyBytes(requests: NetworkRequest[]): number {
  const kept = (body: string | undefined): number =>
    body !== undefined && skippedBodyReason(body) === undefined ? body.length : 0;
  return requests.reduce((sum, r) => sum + kept(r.requestBody) + kept(r.responseBody), 0);
}

/** Ids of the captured requests */
const ids = (requests: NetworkRequest[]): string[] => requests.map((r) => r.requestId);

void describe('network request cap', () => {
  void it('keeps the newest finished requests and counts the dropped ones', async () => {
    const { cdp, requests, evictions } = await collect({ maxRequests: 3 });

    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) cdp.load(id);

    assert.deepEqual(ids(requests), ['r3', 'r4', 'r5']);
    assert.equal(evictions.requestsDropped, 2);
  });

  void it('never drops a request in flight; it is kept once it finishes', async () => {
    const { cdp, requests, evictions } = await collect({ maxRequests: 3 });

    cdp.start('slow');
    for (const id of ['r1', 'r2', 'r3', 'r4']) cdp.load(id);
    cdp.finish('slow');

    assert.deepEqual(ids(requests), ['r3', 'r4', 'slow']);
    assert.equal(evictions.requestsDropped, 2);
  });

  void it('applies to failed requests too', async () => {
    const { cdp, requests, evictions } = await collect({ maxRequests: 2 });

    cdp.load('r1');
    cdp.load('r2');
    cdp.start('broken');
    cdp.emit('Network.loadingFailed', { requestId: 'broken', timestamp: 3, errorText: 'net::X' });

    assert.deepEqual(ids(requests), ['r2', 'broken']);
    assert.equal(evictions.requestsDropped, 1);
  });
});

void describe('network body budget', () => {
  void it('replaces the oldest bodies past the budget, keeping their requests', async () => {
    const { cdp, requests, evictions } = await collect({ maxTotalBodyBytes: 10 });

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      cdp.load(id, 'xxxx');
      await flush();
    }

    assert.deepEqual(ids(requests), ['b1', 'b2', 'b3', 'b4']);
    const [b1, b2, b3, b4] = requests;
    assert.match(skippedBodyReason(b1?.responseBody) ?? '', /^evicted: total body budget/);
    assert.match(skippedBodyReason(b2?.responseBody) ?? '', /^evicted: total body budget/);
    assert.equal(b1?.status, 200, 'metadata stays');
    assert.equal(b3?.responseBody, 'xxxx');
    assert.equal(b4?.responseBody, 'xxxx');
    assert.equal(evictions.bodiesEvicted, 2);
  });

  void it('never holds more body bytes than the budget', async () => {
    const budget = 25;
    const { cdp, requests } = await collect({ maxTotalBodyBytes: budget });

    for (let i = 0; i < 20; i++) {
      cdp.load(`b${i}`, 'y'.repeat(1 + (i % 7)));
      await flush();
      const stored = requests
        .filter((r) => skippedBodyReason(r.responseBody) === undefined)
        .reduce((sum, r) => sum + (r.responseBody?.length ?? 0), 0);
      assert.ok(stored <= budget, `stored ${stored} > ${budget} after b${i}`);
    }
  });

  void it('frees the body bytes of a dropped request', async () => {
    const { cdp, requests, evictions } = await collect({ maxRequests: 2, maxTotalBodyBytes: 10 });

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      cdp.load(id, 'xxxx');
      await flush();
    }

    assert.deepEqual(ids(requests), ['b3', 'b4']);
    assert.equal(requests[0]?.responseBody, 'xxxx');
    assert.equal(requests[1]?.responseBody, 'xxxx');
    assert.equal(evictions.bodiesEvicted, 0);
  });

  void it('does not store a body that arrives after its request was dropped', async () => {
    const { cdp, requests, evictions } = await collect({ maxRequests: 1, maxTotalBodyBytes: 10 });

    cdp.load('b1', 'xxxx');
    cdp.load('b2', 'xxxxxxxx');
    await flush();
    cdp.load('b3', 'xxxx');
    await flush();

    assert.deepEqual(ids(requests), ['b3']);
    assert.equal(requests[0]?.responseBody, 'xxxx');
    assert.equal(evictions.bodiesEvicted, 0);
  });

  void it('counts a body stored twice for the same request once', () => {
    const requests: NetworkRequest[] = [];
    const evictions: NetworkEvictions = { requestsDropped: 0, bodiesEvicted: 0 };
    const retention = new RequestRetention(
      requests,
      { maxRequests: 10, maxTotalBodyBytes: 10 },
      evictions
    );
    const first: NetworkRequest = {
      requestId: 'a',
      url: 'http://x/a',
      method: 'GET',
      timestamp: 0,
    };
    const second: NetworkRequest = {
      requestId: 'b',
      url: 'http://x/b',
      method: 'GET',
      timestamp: 0,
    };
    retention.add(first);
    retention.add(second);

    retention.storeBody(first, 'xxxx', false);
    retention.storeBody(first, 'xxxx', false);
    retention.storeBody(second, 'xxxx', false);

    assert.equal(evictions.bodiesEvicted, 0);
    assert.equal(first.responseBody, 'xxxx');
  });

  void describe('request (POST) bodies', () => {
    void it('count toward the same budget: the total never exceeds it', async () => {
      const budget = 25;
      const { cdp, requests } = await collect({ maxTotalBodyBytes: budget });

      for (let i = 0; i < 20; i++) {
        cdp.post(`p${i}`, 'q'.repeat(1 + (i % 5)), 'y'.repeat(1 + (i % 7)));
        await flush();
        const stored = storedBodyBytes(requests);
        assert.ok(stored <= budget, `stored ${stored} > ${budget} after p${i}`);
      }
    });

    void it('are evicted oldest first, keeping the request and saying why', async () => {
      const { cdp, requests, evictions } = await collect({ maxTotalBodyBytes: 10 });

      for (const id of ['p1', 'p2', 'p3']) {
        cdp.post(id, 'xxxx');
        await flush();
      }

      assert.deepEqual(ids(requests), ['p1', 'p2', 'p3']);
      const [p1, p2, p3] = requests;
      assert.match(skippedBodyReason(p1?.requestBody) ?? '', /^evicted: total body budget/);
      assert.equal(p1?.method, 'POST', 'metadata stays');
      assert.equal(p1?.status, 200, 'metadata stays');
      assert.equal(p2?.requestBody, 'xxxx');
      assert.equal(p3?.requestBody, 'xxxx');
      assert.equal(evictions.bodiesEvicted, 1);
    });

    void it('share the oldest-first order with response bodies', async () => {
      const { cdp, requests, evictions } = await collect({ maxTotalBodyBytes: 12 });

      cdp.post('p1', 'aaaa', 'bbbb');
      await flush();
      cdp.post('p2', 'cccc', 'dddd');
      await flush();

      const [p1, p2] = requests;
      assert.match(skippedBodyReason(p1?.requestBody) ?? '', /^evicted: total body budget/);
      assert.equal(p1?.responseBody, 'bbbb');
      assert.equal(p2?.requestBody, 'cccc');
      assert.equal(p2?.responseBody, 'dddd');
      assert.equal(evictions.bodiesEvicted, 1);
    });

    void it('free their bytes when the request is dropped', async () => {
      const { cdp, requests, evictions } = await collect({ maxRequests: 2, maxTotalBodyBytes: 10 });

      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        cdp.post(id, 'xxxx');
        await flush();
      }

      assert.deepEqual(ids(requests), ['p3', 'p4']);
      assert.equal(requests[0]?.requestBody, 'xxxx');
      assert.equal(requests[1]?.requestBody, 'xxxx');
      assert.equal(evictions.bodiesEvicted, 0);
    });
  });
});
