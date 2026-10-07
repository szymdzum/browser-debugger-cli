/**
 * The accessibility tree is listed depth-first without noise, bounded by
 * --limit and --depth, and the human output is indented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listA11yTree } from '@/telemetry/a11y.js';
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
      listA11yTree(
        treeOf([
          { nodeId: '1', role: 'RootWebArea', name: 'Page', childIds: ['2', '6'] },
          { nodeId: '2', role: 'generic', childIds: ['3'] },
          { nodeId: '3', role: 'button', name: 'Save', childIds: ['4', '5'] },
          { nodeId: '4', role: 'StaticText', name: 'Save', childIds: ['7'] },
          { nodeId: '5', role: 'StaticText', name: ' ' },
          { nodeId: '6', role: 'checkbox', name: 'Agree', properties: { checked: true } },
          { nodeId: '7', role: 'InlineTextBox', name: 'Save' },
        ]),
        50
      )
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
    const cut = formatA11yTree(listA11yTree(treeOf([root, ...many]), 50));
    assert.match(cut, /Showing the first 50 nodes/);
    assert.match(cut, /11 more: --limit 0 lists all, --depth <n>/);
    assert.doesNotMatch(cut, /--json/);
    const whole = listA11yTree(treeOf([root, ...many.slice(0, 49)]), 50);
    assert.doesNotMatch(formatA11yTree(whole), /Showing the first/);
  });

  void it('lists all with limit 0, cuts by depth, and gives depth instead of childIds', () => {
    const tree = treeOf([
      { nodeId: '1', role: 'RootWebArea', name: 'Page', childIds: ['2'] },
      { nodeId: '2', role: 'generic', childIds: ['3'] },
      { nodeId: '3', role: 'navigation', name: 'Main', childIds: ['4', '5'] },
      { nodeId: '4', role: 'link', name: 'Home' },
      { nodeId: '5', role: 'link', name: 'About' },
      { nodeId: '6', role: 'heading', name: 'In a frame' },
    ]);
    const all = listA11yTree(tree, 0);
    assert.deepEqual(
      all.nodes.map((node) => [node.name, node.depth]),
      [
        ['Page', 0],
        ['Main', 1],
        ['Home', 2],
        ['About', 2],
        ['In a frame', 0],
      ]
    );
    assert.equal(all.omitted, undefined);
    assert.equal(all.count, 6);
    assert.ok(all.nodes.every((node) => !('childIds' in node)));

    const shallow = listA11yTree(tree, 0, 1);
    assert.deepEqual(
      shallow.nodes.map((node) => node.name),
      ['Page', 'Main', 'In a frame']
    );
    assert.equal(shallow.omitted, 2);
    assert.equal(listA11yTree(tree, 2).omitted, 3);
  });

  void it('accounts for every node: count = listed + omitted + skipped', () => {
    const tree = treeOf([
      { nodeId: '1', role: 'RootWebArea', name: 'Page', childIds: ['2', '6'] },
      { nodeId: '2', role: 'generic', childIds: ['3'] },
      { nodeId: '3', role: 'button', name: 'Save', childIds: ['4', '5'] },
      { nodeId: '4', role: 'StaticText', name: 'Save', childIds: ['7'] },
      { nodeId: '5', role: 'StaticText', name: ' ' },
      { nodeId: '6', role: 'checkbox', name: 'Agree' },
      { nodeId: '7', role: 'InlineTextBox', name: 'Save' },
    ]);
    for (const [limit, depth] of [[0], [1], [2, 0], [0, 1]] as Array<[number, number?]>) {
      const listed = listA11yTree(tree, limit, depth);
      assert.equal(listed.skipped, 4);
      assert.equal(
        listed.nodes.length + (listed.omitted ?? 0) + (listed.skipped ?? 0),
        listed.count,
        `limit ${limit}, depth ${depth}`
      );
    }
    assert.equal(listA11yTree(tree, 0).omitted, undefined);
  });
});
