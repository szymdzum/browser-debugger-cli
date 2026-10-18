/**
 * Unit tests for sendTyped's argument pass-through.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sendToBrowserTyped, sendTyped } from '@/connection/typed-cdp.js';

/**
 * A sender recording the arguments of its calls.
 *
 * @returns Sender and the recorded argument lists
 */
function recordingSender(): { cdp: Parameters<typeof sendTyped>[0]; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const cdp = {
    send: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve({ ok: true });
    },
  } as Parameters<typeof sendTyped>[0];
  return { cdp, calls };
}

describe('sendTyped', () => {
  it('passes the signal as the 4th argument with no session id', async () => {
    const { cdp, calls } = recordingSender();
    const signal = new AbortController().signal;
    const result = await sendTyped(cdp, 'Page.navigate', { url: 'http://a/' }, { signal });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.slice(0, 3), ['Page.navigate', { url: 'http://a/' }, undefined]);
    assert.equal(calls[0]?.[3], signal);
  });

  it('sends no signal without options', async () => {
    const { cdp, calls } = recordingSender();
    await sendTyped(cdp, 'Page.getFrameTree');
    assert.deepEqual(calls[0], ['Page.getFrameTree', undefined, undefined, undefined]);
  });
});

describe('sendToBrowserTyped', () => {
  it('sends on the browser connection and returns the reply', async () => {
    const calls: unknown[][] = [];
    const cdp = {
      sendToBrowser: (...args: unknown[]): Promise<unknown> => {
        calls.push(args);
        return Promise.resolve({ sessionId: 's1' });
      },
    } as Parameters<typeof sendToBrowserTyped>[0];
    const result = await sendToBrowserTyped(cdp, 'Target.attachToTarget', {
      targetId: 't1',
      flatten: true,
    });
    assert.deepEqual(result, { sessionId: 's1' });
    assert.deepEqual(calls, [['Target.attachToTarget', { targetId: 't1', flatten: true }]]);
  });
});
