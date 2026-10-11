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
});
