/**
 * The shared best-effort release of an object group (#606): never throws,
 * never waits longer than its limit.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { releaseObjectGroup } from '@/runtime/page/objectGroups.js';

void describe('releaseObjectGroup', () => {
  void it('sends the release of the group', async () => {
    const sent: unknown[] = [];
    await releaseObjectGroup(
      { send: (method, params) => Promise.resolve(sent.push({ method, params })) },
      'g1'
    );
    assert.deepEqual(sent, [
      { method: 'Runtime.releaseObjectGroup', params: { objectGroup: 'g1' } },
    ]);
  });

  void it('does not throw when the page fails the release', async () => {
    await releaseObjectGroup({ send: () => Promise.reject(new Error('gone')) }, 'g1');
  });

  void it('does not throw when sending fails at once', async () => {
    await releaseObjectGroup(
      {
        send: () => {
          throw new Error('not connected');
        },
      },
      'g1'
    );
  });

  void it('gives up on a page that never answers', async () => {
    const started = Date.now();
    await releaseObjectGroup({ send: () => new Promise(() => undefined) }, 'g1', 50);
    assert.ok(Date.now() - started < 1000, 'waited past its limit');
  });
});
