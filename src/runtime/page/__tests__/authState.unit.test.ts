/**
 * Restoring `--state` before the first navigation (#454) against a fake
 * connection: a failed setup of the blank-document interception turns it
 * all off again, and an http origin Chrome upgrades to https (HSTS,
 * HTTPS-First) is skipped instead of failing the start.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { AuthStateContent } from '@/ipc/protocol/stateTypes.js';
import { restoreAuthStateBeforeLoad } from '@/runtime/page/authState.js';

/** A fake page connection */
interface FakeConnection {
  cdp: CDPConnection;
  /** Methods sent, in order */
  sent: Array<{ method: string; params: Record<string, unknown> }>;
  /** Event listeners still registered */
  listeners: () => number;
}

/**
 * A fake page connection.
 *
 * @param answer - Answers a method (throw to reject)
 * @returns Connection and what it saw
 */
function fakeConnection(
  answer: (method: string, params: Record<string, unknown>, url: { current: string }) => unknown
): FakeConnection {
  const sent: FakeConnection['sent'] = [];
  const handlers = new Set<unknown>();
  const url = { current: 'about:blank' };
  const cdp = {
    send: async (method: string, params: Record<string, unknown> = {}) => {
      sent.push({ method, params });
      await Promise.resolve();
      return answer(method, params, url);
    },
    on: (_event: string, handler: unknown) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  } as unknown as CDPConnection;
  return { cdp, sent, listeners: () => handlers.size };
}

/**
 * The top frame for a URL, as `Page.getFrameTree` gives it.
 *
 * @param url - Its URL
 * @returns Frame tree response
 */
function frameTree(url: string): unknown {
  const origin = url.startsWith('http') ? new URL(url).origin : '://';
  return { frameTree: { frame: { id: 'F', url, securityOrigin: origin } } };
}

/** One http origin with storage */
const STATE: AuthStateContent = {
  cookies: [],
  origins: [{ origin: 'http://a.example', localStorage: { k: 'v' }, sessionStorage: {} }],
};

void describe('restoreAuthStateBeforeLoad', () => {
  void it('turns interception and the service worker bypass off when Fetch.enable fails', async () => {
    const fake = fakeConnection((method) => {
      if (method === 'Fetch.enable') throw new Error('Fetch.enable failed');
      return {};
    });
    await assert.rejects(restoreAuthStateBeforeLoad(fake.cdp, STATE), /Fetch.enable failed/);
    const methods = fake.sent.map((s) => s.method);
    assert.ok(methods.includes('Fetch.disable'), `Fetch.disable sent: ${methods.join(', ')}`);
    const bypass = fake.sent.filter((s) => s.method === 'Network.setBypassServiceWorker');
    assert.deepEqual(
      bypass.map((s) => s.params['bypass']),
      [true, false]
    );
    assert.ok(methods.includes('Network.disable'));
    assert.equal(fake.listeners(), 0, 'the Fetch.requestPaused listener is removed');
    assert.ok(!methods.includes('Page.navigate'), 'no navigation after the failure');
  });

  void it('skips an http origin Chrome upgraded to https instead of failing', async () => {
    const fake = fakeConnection((method, params, url) => {
      if (method === 'Page.navigate') {
        const target = String(params['url']);
        url.current = target.replace(/^http:/, 'https:');
        return {};
      }
      if (method === 'Page.getFrameTree') return frameTree(url.current);
      return {};
    });
    const summary = await restoreAuthStateBeforeLoad(fake.cdp, STATE);
    assert.deepEqual(summary.origins, []);
    assert.deepEqual(summary.skipped, [
      { origin: 'http://a.example', reason: 'upgraded-to-https' },
    ]);
    assert.ok(
      !fake.sent.some((s) => s.method === 'DOMStorage.setDOMStorageItem'),
      'nothing written to the https origin'
    );
    assert.ok(fake.sent.some((s) => s.method === 'Fetch.disable'));
  });

  void it('writes the storage of an origin that loads as saved', async () => {
    const fake = fakeConnection((method, params, url) => {
      if (method === 'Page.navigate') url.current = String(params['url']);
      if (method === 'Page.getFrameTree') return frameTree(url.current);
      return {};
    });
    const summary = await restoreAuthStateBeforeLoad(fake.cdp, STATE);
    assert.deepEqual(summary.origins, [
      { origin: 'http://a.example', localStorage: 1, sessionStorage: 0 },
    ]);
    assert.equal(summary.skipped, undefined);
    const write = fake.sent.find((s) => s.method === 'DOMStorage.setDOMStorageItem');
    assert.deepEqual(write?.params['storageId'], {
      storageKey: 'http://a.example/',
      isLocalStorage: true,
    });
  });
});
