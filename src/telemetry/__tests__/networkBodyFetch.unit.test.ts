/**
 * A response body Chrome refuses to return (`Network.getResponseBody` fails)
 * is reported as not captured, with the reason, in `details` and the HAR.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { createCommandRegistry } from '@/daemon/session/commandRegistry.js';
import { buildHAR } from '@/telemetry/har/builder.js';
import { startNetworkCollection } from '@/telemetry/network.js';
import type { CleanupFunction, NetworkRequest } from '@/types.js';
import { bodyFetchFailedReason } from '@/ui/messages/networkMessages.js';

type Handler = (params: unknown) => void;

/**
 * CDP stub whose `Network.getResponseBody` fails, as Chrome's does once its
 * network buffer no longer has the body. The failure is delivered when the
 * test calls {@link FailingCDP.failFetches}.
 */
class FailingCDP {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly pending: Array<(error: Error) => void> = [];

  /** Hold `Network.getResponseBody` until failed, answer everything else with `{}` */
  send(method: string): Promise<unknown> {
    if (method !== 'Network.getResponseBody') return Promise.resolve({});
    return new Promise((_resolve, reject) => this.pending.push(reject));
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

  /** Fail every held body fetch with Chrome's error, then let the rejections settle */
  async failFetches(): Promise<void> {
    for (const reject of this.pending.splice(0)) {
      reject(new Error('No resource with given identifier found'));
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Load a JSON request to the end.
   *
   * @param requestId - Request id
   * @param response - Method and status of the exchange
   */
  load(requestId: string, response: { method?: string; status?: number } = {}): void {
    this.emit('Network.requestWillBeSent', {
      requestId,
      loaderId: 'loader',
      frameId: 'frame',
      request: { url: `http://127.0.0.1:8080/${requestId}`, method: response.method ?? 'POST' },
      timestamp: 1,
      type: 'Fetch',
    });
    this.emit('Network.responseReceived', {
      requestId,
      type: 'Fetch',
      response: {
        url: '',
        status: response.status ?? 200,
        headers: {},
        mimeType: 'application/json',
      },
    });
    this.emit('Network.loadingFinished', { requestId, timestamp: 2, encodedDataLength: 10 });
  }
}

/**
 * Start collecting into a session store.
 *
 * @returns CDP stub, store and the collector's cleanup
 */
async function collect(): Promise<{
  cdp: FailingCDP;
  store: TelemetryStore;
  stop: CleanupFunction;
}> {
  const cdp = new FailingCDP();
  const store = new TelemetryStore();
  const stop = await startNetworkCollection(
    cdp as unknown as CDPConnection,
    store.networkRequests,
    { includeAll: true }
  );
  return { cdp, store, stop };
}

/**
 * The request as `bdg details network <id> --json` reports it.
 *
 * @param store - Session store
 * @param id - Request id
 * @returns Reported request
 */
async function details(store: TelemetryStore, id: string): Promise<NetworkRequest> {
  const registry = createCommandRegistry(store, { get: () => ({}), set: () => undefined });
  const cdp = { send: () => Promise.resolve({}) } as unknown as CDPConnection;
  const { item } = await registry.session_details(cdp, { itemType: 'network', id });
  return item as NetworkRequest;
}

/**
 * The HAR content comment of a captured request.
 *
 * @param store - Session store
 * @param id - Request id
 * @returns `content.comment` of its entry
 */
function harComment(store: TelemetryStore, id: string): string | undefined {
  const request = store.networkRequests.find((r) => r.requestId === id);
  assert.ok(request);
  const har = buildHAR([request], { version: '0.0.0-test' }, { includeSensitive: true });
  return har.log.entries[0]?.response.content.comment;
}

void describe('failed response body fetch', () => {
  void it('reports the body as not captured, with the reason, in details and the HAR', async () => {
    const { cdp, store } = await collect();

    cdp.load('big');
    await cdp.failFetches();

    const request = await details(store, 'big');
    assert.equal(request.responseBody, undefined);
    assert.equal(request.bodyNotCaptured, bodyFetchFailedReason());
    assert.equal(harComment(store, 'big'), `Body not captured: ${bodyFetchFailedReason()}`);
  });

  void it('stores nothing once the collector has stopped', async () => {
    const { cdp, store, stop } = await collect();

    cdp.load('late');
    stop();
    await cdp.failFetches();

    const request = await details(store, 'late');
    assert.equal(request.responseBody, undefined);
    assert.equal(request.bodyNotCaptured, undefined);
  });

  for (const [label, response] of [
    ['a 204', { status: 204 }],
    ['a 304', { status: 304 }],
    ['a HEAD request', { method: 'HEAD' }],
  ] as const) {
    void it(`gives no reason for ${label}, which has no body`, async () => {
      const { cdp, store } = await collect();

      cdp.load('empty', response);
      await cdp.failFetches();

      const request = await details(store, 'empty');
      assert.equal(request.bodyNotCaptured, undefined);
      assert.equal(harComment(store, 'empty'), undefined);
    });
  }
});
