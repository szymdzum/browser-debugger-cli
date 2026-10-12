/**
 * The handle `selectorOfNode` makes for the element is released on success
 * and on failure, and a release that fails changes nothing (#630).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { selectorOfNode } from '@/runtime/dom/targetNode.js';

/** A recorded CDP call */
interface Call {
  method: string;
  params: Record<string, unknown>;
}

/**
 * A page whose node resolves to `o1`, whose builder returns `value` or throws.
 *
 * @param options - Builder outcome and whether the release fails
 * @returns The connection and the calls it received
 */
function fakePage(options: { value?: string; builderFails?: boolean; releaseFails?: boolean }): {
  cdp: CDPConnection;
  calls: Call[];
} {
  const calls: Call[] = [];
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ method, params });
    if (method === 'DOM.resolveNode') return Promise.resolve({ object: { objectId: 'o1' } });
    if (method === 'Runtime.releaseObjectGroup') {
      return options.releaseFails ? Promise.reject(new Error('gone')) : Promise.resolve({});
    }
    const probe = String(params['functionDeclaration']).includes('isConnected');
    if (probe) return Promise.resolve({ result: { value: true } });
    return options.builderFails
      ? Promise.reject(new Error('builder failed'))
      : Promise.resolve({ result: { value: options.value } });
  };
  return { cdp: { send } as unknown as CDPConnection, calls };
}

/**
 * The group the node was resolved into and the group released.
 *
 * @param calls - Recorded calls
 * @returns Both group names
 */
function groups(calls: Call[]): { resolved: unknown; released: unknown[] } {
  return {
    resolved: calls.find((c) => c.method === 'DOM.resolveNode')?.params['objectGroup'],
    released: calls
      .filter((c) => c.method === 'Runtime.releaseObjectGroup')
      .map((c) => c.params['objectGroup']),
  };
}

void describe('selectorOfNode', () => {
  void it('releases the node it resolved after building the selector', async () => {
    const { cdp, calls } = fakePage({ value: '#go' });
    assert.equal(await selectorOfNode(cdp, 7), '#go');
    const { resolved, released } = groups(calls);
    assert.equal(typeof resolved, 'string');
    assert.deepEqual(released, [resolved]);
  });

  void it('releases it when the builder fails, and returns null', async () => {
    const { cdp, calls } = fakePage({ builderFails: true });
    assert.equal(await selectorOfNode(cdp, 7), null);
    const { resolved, released } = groups(calls);
    assert.deepEqual(released, [resolved]);
  });

  void it('returns the selector although the release fails', async () => {
    const { cdp } = fakePage({ value: '#go', releaseFails: true });
    assert.equal(await selectorOfNode(cdp, 7), '#go');
  });
});
