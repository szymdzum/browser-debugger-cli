/**
 * `dom a11y` checks each field with a value for being a secret; checks that
 * run at the same time (in one command or in parallel commands) do not free
 * each other's page objects, which would mask a plain value (#584).
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startFakeDaemon } from '@/__testutils__/fakeDaemon.js';
import { FakeObjectPage } from '@/__testutils__/fakeObjectPage.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { collectA11yTree } from '@/telemetry/a11y.js';

/**
 * A text field with a value.
 *
 * @param id - Accessibility node id and backend node id
 * @param value - Its value
 * @returns The node
 */
function textbox(id: number, value: string): Protocol.Accessibility.AXNode {
  return {
    nodeId: String(id),
    ignored: false,
    role: { type: 'role', value: 'textbox' },
    name: { type: 'computedString', value: `Field ${id}` },
    value: { type: 'string', value },
    backendDOMNodeId: id,
  };
}

const NODES: Protocol.Accessibility.AXNode[] = [
  {
    nodeId: '100',
    ignored: false,
    role: { type: 'role', value: 'RootWebArea' },
    childIds: ['1', '2'],
  },
  textbox(1, 'Paris'),
  textbox(2, 'Lyon'),
];

void describe('a11y secret field check', () => {
  const sessionDir = process.env['BDG_SESSION_DIR'];

  before(() => {
    process.env['BDG_SESSION_DIR'] = makeTempDir('bdg-584-');
  });

  after(() => {
    if (sessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
    else process.env['BDG_SESSION_DIR'] = sessionDir;
    removeTempDirs();
  });

  void it('keeps plain values when one check releases its objects before another reads (#584)', async () => {
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) => method === 'DOM.resolveNode' && params['backendNodeId'] === 2,
      callResult: () => ({ result: { type: 'boolean', value: false } }),
    });
    const daemon = await startFakeDaemon({
      send: (method, params) =>
        method === 'Accessibility.getFullAXTree' && params?.['frameId'] === undefined
          ? Promise.resolve({ nodes: NODES })
          : page.send(method, params),
    });
    try {
      const tree = await collectA11yTree();
      assert.deepEqual(
        [tree.nodes.get('1')?.value, tree.nodes.get('2')?.value],
        ['Paris', 'Lyon'],
        'a plain value was masked'
      );
      assert.deepEqual(page.releasedUses, []);
    } finally {
      await daemon.close();
    }
  });
});
