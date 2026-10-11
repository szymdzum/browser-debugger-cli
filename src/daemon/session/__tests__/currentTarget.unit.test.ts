import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { refreshCurrentTarget } from '@/daemon/session/currentTarget.js';
import type { CDPTarget } from '@/types.js';

/**
 * A store holding a session page.
 *
 * @returns Store
 */
function storeWithPage(): TelemetryStore {
  const store = new TelemetryStore();
  store.setTargetInfo({ id: 'A', url: 'http://x/', title: 'old' } as CDPTarget);
  return store;
}

void describe('refreshCurrentTarget', () => {
  void it('takes the URL with its fragment and the title Chrome reports for the page', async () => {
    const store = storeWithPage();
    await refreshCurrentTarget(
      {
        send: () =>
          Promise.resolve({ targetInfo: { targetId: 'A', url: 'http://x/#f', title: 'new' } }),
      },
      store
    );
    assert.equal(store.targetInfo?.url, 'http://x/#f');
    assert.equal(store.targetInfo?.title, 'new');
  });

  void it('keeps the stored page when Chrome answers for another target or fails', async () => {
    const store = storeWithPage();
    await refreshCurrentTarget(
      {
        send: () =>
          Promise.resolve({ targetInfo: { targetId: 'B', url: 'http://y/', title: 'b' } }),
      },
      store
    );
    await refreshCurrentTarget({ send: () => Promise.reject(new Error('crashed')) }, store);
    assert.equal(store.targetInfo?.title, 'old');
    assert.equal(store.targetInfo?.url, 'http://x/');
  });

  void it('keeps the stored page when Chrome does not answer within the timeout', async () => {
    const store = storeWithPage();
    const started = Date.now();
    await refreshCurrentTarget({ send: () => new Promise(() => undefined) }, store, 50);
    assert.ok(Date.now() - started < 1000);
    assert.equal(store.targetInfo?.title, 'old');
  });

  void it('drops an answer when the page navigated while it was on its way', async () => {
    const store = storeWithPage();
    let answer: (value: unknown) => void = () => undefined;
    const pending = refreshCurrentTarget(
      { send: () => new Promise((resolve) => (answer = resolve)) },
      store
    );
    store.setTargetInfo({ ...(store.targetInfo as CDPTarget), url: 'http://x/new', title: '' });
    answer({ targetInfo: { targetId: 'A', url: 'http://x/', title: 'old page' } });
    await pending;
    assert.equal(store.targetInfo?.url, 'http://x/new');
    assert.equal(store.targetInfo?.title, '');
  });
});
