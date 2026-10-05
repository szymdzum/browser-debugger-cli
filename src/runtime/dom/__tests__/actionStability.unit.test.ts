/**
 * The network wait around DOM actions sees requests the action itself starts
 * and never blocks on Network.enable.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { withActionStability } from '@/runtime/dom/formFillHelpers/stability.js';

/** Fake CDP connection whose events the test emits. */
interface FakeCdp {
  cdp: CDPConnection;
  emit: (event: string, requestId: string) => void;
  sent: string[];
}

/**
 * Build a fake CDP connection.
 *
 * @param send - Answer to every command (default: resolves at once)
 * @returns Connection plus an event emitter and the commands sent
 */
function fakeCdp(send: () => Promise<unknown> = () => Promise.resolve({})): FakeCdp {
  const events = new EventEmitter();
  const sent: string[] = [];
  const cdp = {
    send: (method: string) => {
      sent.push(method);
      return send();
    },
    on: (event: string, handler: (params: unknown) => void) => {
      events.on(event, handler);
      return () => events.off(event, handler);
    },
  } as unknown as CDPConnection;
  return { cdp, emit: (event, requestId) => events.emit(event, { requestId }), sent };
}

/**
 * Time an action run with the stability wait.
 *
 * @param cdp - Connection
 * @param action - Action
 * @param wait - Whether to wait
 * @returns Elapsed milliseconds
 */
async function timed(
  cdp: CDPConnection,
  action: () => Promise<{ success: boolean }>,
  wait = true
): Promise<number> {
  const start = Date.now();
  await withActionStability(cdp, action, wait);
  return Date.now() - start;
}

void describe('withActionStability', () => {
  void it('waits for a request the action starts before it returns', async () => {
    const { cdp, emit } = fakeCdp();
    const elapsed = await timed(cdp, () => {
      emit('Network.requestWillBeSent', 'api');
      setTimeout(() => emit('Network.loadingFinished', 'api'), 400);
      return Promise.resolve({ success: true });
    });
    assert.ok(elapsed >= 400 + 150, `returned after ${elapsed}ms`);
    assert.ok(elapsed < 1500, `returned after ${elapsed}ms`);
  });

  void it('waits 150 ms after the action for requests it starts later', async () => {
    const { cdp, emit } = fakeCdp();
    const elapsed = await timed(cdp, () => {
      setTimeout(() => emit('Network.requestWillBeSent', 'late'), 50);
      setTimeout(() => emit('Network.loadingFailed', 'late'), 300);
      return Promise.resolve({ success: true });
    });
    assert.ok(elapsed >= 300 + 150, `returned after ${elapsed}ms`);
  });

  void it('returns after 2 s when Network.enable hangs and a request never ends', async () => {
    const { cdp, emit, sent } = fakeCdp(() => new Promise(() => undefined));
    const elapsed = await timed(cdp, () => {
      emit('Network.requestWillBeSent', 'navigation');
      return Promise.resolve({ success: true });
    });
    assert.deepEqual(sent, ['Network.enable']);
    assert.ok(elapsed >= 2000 && elapsed < 2500, `returned after ${elapsed}ms`);
  });

  void it('does not wait after a failed action or with --no-wait', async () => {
    const { cdp, emit, sent } = fakeCdp();
    const failed = await timed(cdp, () => {
      emit('Network.requestWillBeSent', 'api');
      return Promise.resolve({ success: false });
    });
    assert.ok(failed < 100, `returned after ${failed}ms`);

    sent.length = 0;
    const noWait = await timed(cdp, () => Promise.resolve({ success: true }), false);
    assert.ok(noWait < 100, `returned after ${noWait}ms`);
    assert.deepEqual(sent, []);
  });
});
