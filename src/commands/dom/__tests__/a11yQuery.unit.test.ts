/**
 * `bdg dom a11y query`: an element reported by the page's tree and its
 * frame's tree is listed once, and the list is cut to `--limit`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { limitMatches } from '@/commands/dom/a11y.js';
import { queryA11yTree } from '@/telemetry/a11y.js';
import type { A11yNode, A11yTree } from '@/types.js';

/**
 * A button node.
 *
 * @param nodeId - Accessibility node id
 * @param backendDOMNodeId - Element it stands for, if any
 * @returns Node
 */
function button(nodeId: string, backendDOMNodeId?: number): A11yNode {
  return {
    nodeId,
    role: 'button',
    name: 'Accept all',
    ...(backendDOMNodeId !== undefined && { backendDOMNodeId }),
  };
}

/**
 * Tree holding the given nodes.
 *
 * @param nodes - Nodes
 * @returns Tree
 */
function treeOf(nodes: A11yNode[]): A11yTree {
  return {
    root: nodes[0] as A11yNode,
    nodes: new Map(nodes.map((node) => [node.nodeId, node])),
    count: nodes.length,
  };
}

void describe('queryA11yTree', () => {
  void it('lists an element reported twice once', () => {
    const result = queryA11yTree(treeOf([button('1', 7), button('f0:1', 7), button('2', 8)]), {
      name: 'Accept',
    });
    assert.deepEqual(
      result.nodes.map((node) => node.nodeId),
      ['1', '2']
    );
    assert.equal(result.count, 2);
  });

  void it('keeps nodes without an element', () => {
    const result = queryA11yTree(treeOf([button('1'), button('2')]), { role: 'button' });
    assert.equal(result.count, 2);
  });
});

void describe('limitMatches', () => {
  const result = {
    nodes: [button('1', 1), button('2', 2), button('3', 3)],
    count: 3,
    pattern: { role: 'button' },
  };

  void it('lists the first matches and counts the rest as omitted', () => {
    const limited = limitMatches(result, 2);
    assert.equal(limited.nodes.length, 2);
    assert.equal(limited.omitted, 1);
    assert.equal(limited.count, 3);
  });

  void it('lists all with 0 or a limit above the matches', () => {
    assert.equal(limitMatches(result, 0), result);
    assert.equal(limitMatches(result, 3), result);
  });
});
