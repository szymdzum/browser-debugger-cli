/**
 * The daemon releases the object groups of a bdg CLI that exited before
 * releasing them, e.g. killed mid-call (#606), and no others.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ClientObjectGroups } from '@/daemon/session/clientObjectGroups.js';
import type { ObjectGroupSender } from '@/runtime/page/objectGroups.js';

/**
 * A page recording the groups released on it.
 *
 * @param fails - Whether its releases fail
 * @returns The page and the released groups
 */
function fakePage(fails = false): { page: ObjectGroupSender; released: unknown[] } {
  const released: unknown[] = [];
  const page: ObjectGroupSender = {
    send: (method, params) => {
      if (method === 'Runtime.releaseObjectGroup') released.push(params['objectGroup']);
      return fails ? Promise.reject(new Error('page gone')) : Promise.resolve({});
    },
  };
  return { page, released };
}

/**
 * A call that creates a group for a CLI.
 *
 * @param objectGroup - The group
 * @param owner - The CLI's process id
 * @returns The call
 */
function creating(
  objectGroup: string,
  owner?: number
): Parameters<ClientObjectGroups['settled']>[1] {
  return {
    method: 'DOM.resolveNode',
    params: { backendNodeId: 1, objectGroup },
    ...(owner !== undefined && { owner }),
  };
}

void describe('ClientObjectGroups', () => {
  void it('releases the groups of an exited CLI, once', async () => {
    const alive = new Set([10, 11]);
    const groups = new ClientObjectGroups((pid) => alive.has(pid));
    const { page, released } = fakePage();
    groups.settled(page, creating('bdg-query-10-1', 10));
    groups.settled(page, creating('bdg-node-11-1', 11));
    assert.deepEqual(await groups.releaseOrphans(), []);
    alive.delete(10);
    assert.deepEqual(await groups.releaseOrphans(), ['bdg-query-10-1']);
    assert.deepEqual(released, ['bdg-query-10-1']);
    assert.deepEqual(await groups.releaseOrphans(), []);
  });

  void it('forgets a group its CLI released', async () => {
    const groups = new ClientObjectGroups(() => false);
    const { page, released } = fakePage();
    groups.settled(page, creating('bdg-check-10-1', 10));
    groups.settled(page, {
      method: 'Runtime.releaseObjectGroup',
      params: { objectGroup: 'bdg-check-10-1' },
    });
    assert.deepEqual(await groups.releaseOrphans(), []);
    assert.deepEqual(released, []);
  });

  void it('leaves groups without an owner alone (bdg cdp)', async () => {
    const groups = new ClientObjectGroups(() => false);
    const { page } = fakePage();
    groups.settled(page, creating('mine'));
    assert.deepEqual(await groups.releaseOrphans(), []);
  });

  void it('releases on the page the group was made on, and never throws', async () => {
    const groups = new ClientObjectGroups(() => false);
    const first = fakePage(true);
    const second = fakePage();
    groups.settled(first.page, creating('bdg-a11y-secret-10-1', 10));
    groups.settled(second.page, creating('bdg-node-10-2', 10));
    const orphans = await groups.releaseOrphans();
    assert.deepEqual(orphans.sort(), ['bdg-a11y-secret-10-1', 'bdg-node-10-2']);
    assert.deepEqual(first.released, ['bdg-a11y-secret-10-1']);
    assert.deepEqual(second.released, ['bdg-node-10-2']);
  });

  void it('ignores an owner that is not a process id, and tracks nothing for it', async () => {
    const checked: unknown[] = [];
    const groups = new ClientObjectGroups((pid) => {
      checked.push(pid);
      return false;
    });
    const { page, released } = fakePage();
    for (const owner of [0, -1, 1.5, Number.NaN, '10', null]) {
      groups.settled(page, {
        method: 'DOM.resolveNode',
        params: { objectGroup: `g-${String(owner)}` },
        owner,
      });
    }
    assert.deepEqual(await groups.releaseOrphans(), []);
    assert.deepEqual(checked, []);
    assert.deepEqual(released, []);
  });

  void it('forgets every group when the page is gone', async () => {
    const groups = new ClientObjectGroups(() => false);
    const { page, released } = fakePage();
    groups.settled(page, creating('bdg-query-10-1', 10));
    groups.clear();
    assert.deepEqual(await groups.releaseOrphans(), []);
    assert.deepEqual(released, []);
  });

  void it('never releases a group twice when sweeps overlap', async () => {
    const groups = new ClientObjectGroups(() => false);
    const { page, released } = fakePage();
    groups.settled(page, creating('bdg-query-10-1', 10));
    await Promise.all([groups.releaseOrphans(), groups.releaseOrphans()]);
    assert.deepEqual(released, ['bdg-query-10-1']);
  });
});
