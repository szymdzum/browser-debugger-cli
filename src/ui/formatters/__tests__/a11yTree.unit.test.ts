/**
 * The human accessibility tree is indented and leaves out noise.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { A11yNode, A11yTree } from '@/types.js';
import { formatA11yTree } from '@/ui/formatters/a11y.js';

/**
 * Build a tree from nodes (the first is the root).
 *
 * @param nodes - Nodes
 * @returns Tree
 */
function treeOf(nodes: A11yNode[]): A11yTree {
  const map = new Map(nodes.map((node) => [node.nodeId, node]));
  return { root: nodes[0] as A11yNode, nodes: map, count: nodes.length };
}

void describe('formatA11yTree', () => {
  void it('indents children and leaves out text boxes, blank and repeated text', () => {
    const output = formatA11yTree(
      treeOf([
        { nodeId: '1', role: 'RootWebArea', name: 'Page', childIds: ['2', '6'] },
        { nodeId: '2', role: 'generic', childIds: ['3'] },
        { nodeId: '3', role: 'button', name: 'Save', childIds: ['4', '5'] },
        { nodeId: '4', role: 'StaticText', name: 'Save', childIds: ['7'] },
        { nodeId: '5', role: 'StaticText', name: ' ' },
        { nodeId: '6', role: 'checkbox', name: 'Agree', properties: { checked: true } },
        { nodeId: '7', role: 'InlineTextBox', name: 'Save' },
      ])
    );
    const lines = output.split('\n').filter((line) => line.includes('['));
    assert.deepEqual(lines, [
      '[RootWebArea] "Page"',
      '  [Button] "Save"',
      '  [Checkbox] "Agree" (checked)',
    ]);
  });

  void it('says nodes were left out only when the budget cut the tree', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      nodeId: String(i + 2),
      role: 'button',
      name: `B${i}`,
    }));
    const root = {
      nodeId: '1',
      role: 'RootWebArea',
      name: 'Page',
      childIds: many.map((n) => n.nodeId),
    };
    assert.match(formatA11yTree(treeOf([root, ...many])), /Showing the first 50 nodes/);
    assert.doesNotMatch(formatA11yTree(treeOf([root, ...many.slice(0, 49)])), /Showing the first/);
  });
});
