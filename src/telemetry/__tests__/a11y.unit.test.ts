/**
 * Unit tests for accessibility tree pure functions.
 *
 * Tests the contract of pure functions:
 * - buildTreeFromRawNodes: Tree construction from CDP nodes
 * - parseQueryPattern: Pattern string parsing
 * - queryA11yTree: Tree querying logic
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { buildTreeFromRawNodes, parseQueryPattern, queryA11yTree } from '@/telemetry/a11y.js';
import type { A11yTree } from '@/types.js';

describe('buildTreeFromRawNodes', () => {
  test('builds tree from valid CDP nodes', () => {
    const rawNodes: Protocol.Accessibility.AXNode[] = [
      {
        nodeId: '1',
        ignored: false,
        role: { type: 'role', value: 'RootWebArea' },
        name: { type: 'computedString', value: 'Test Page' },
        childIds: ['2', '3'],
      },
      {
        nodeId: '2',
        ignored: false,
        role: { type: 'role', value: 'button' },
        name: { type: 'computedString', value: 'Submit' },
        properties: [{ name: 'focusable', value: { type: 'boolean', value: true } }],
      },
      {
        nodeId: '3',
        ignored: false,
        role: { type: 'role', value: 'textbox' },
        name: { type: 'computedString', value: 'Email' },
        properties: [{ name: 'required', value: { type: 'boolean', value: true } }],
      },
    ];

    const tree = buildTreeFromRawNodes(rawNodes);

    assert.equal(tree.count, 3, 'Should count all non-ignored nodes');
    assert.equal(tree.root.role, 'RootWebArea', 'First node should be root');
    assert.equal(tree.root.name, 'Test Page');
    assert.ok(tree.nodes.has('1'), 'Should index node by nodeId');
    assert.ok(tree.nodes.has('2'), 'Should index all nodes');
    assert.ok(tree.nodes.has('3'), 'Should index all nodes');
  });

  test('filters out ignored nodes', () => {
    const rawNodes: Protocol.Accessibility.AXNode[] = [
      {
        nodeId: '1',
        ignored: false,
        role: { type: 'role', value: 'button' },
        name: { type: 'computedString', value: 'Click Me' },
      },
      {
        nodeId: '2',
        ignored: true,
        ignoredReasons: [{ name: 'uninteresting', value: { type: 'boolean', value: true } }],
        role: { type: 'role', value: 'none' },
      },
      {
        nodeId: '3',
        ignored: false,
        role: { type: 'role', value: 'textbox' },
        name: { type: 'computedString', value: 'Input' },
      },
    ];

    const tree = buildTreeFromRawNodes(rawNodes);

    assert.equal(tree.count, 2, 'Should exclude ignored nodes');
    assert.ok(tree.nodes.has('1'), 'Should include non-ignored nodes');
    assert.ok(!tree.nodes.has('2'), 'Should exclude ignored node');
    assert.ok(tree.nodes.has('3'), 'Should include non-ignored nodes');
  });

  test('extracts common properties (focusable, focused, disabled, required)', () => {
    const rawNodes: Protocol.Accessibility.AXNode[] = [
      {
        nodeId: '1',
        ignored: false,
        role: { type: 'role', value: 'textbox' },
        name: { type: 'computedString', value: 'Email' },
        properties: [
          { name: 'focusable', value: { type: 'boolean', value: true } },
          { name: 'focused', value: { type: 'boolean', value: true } },
          { name: 'required', value: { type: 'boolean', value: true } },
        ],
      },
    ];

    const tree = buildTreeFromRawNodes(rawNodes);
    const node = tree.nodes.get('1');

    assert.ok(node);
    assert.equal(node.focusable, true);
    assert.equal(node.focused, true);
    assert.equal(node.required, true);
  });

  test('stores non-standard properties in properties map', () => {
    const rawNodes: Protocol.Accessibility.AXNode[] = [
      {
        nodeId: '1',
        ignored: false,
        role: { type: 'role', value: 'textbox' },
        properties: [
          { name: 'invalid', value: { type: 'string', value: 'false' } },
          { name: 'editable', value: { type: 'string', value: 'plaintext' } },
        ],
      },
    ];

    const tree = buildTreeFromRawNodes(rawNodes);
    const node = tree.nodes.get('1');

    assert.ok(node);
    assert.ok(node.properties);
    assert.equal(node.properties['invalid'], 'false');
    assert.equal(node.properties['editable'], 'plaintext');
  });

  test('throws error when no non-ignored nodes found', () => {
    const rawNodes: Protocol.Accessibility.AXNode[] = [
      {
        nodeId: '1',
        ignored: true,
        ignoredReasons: [{ name: 'uninteresting', value: { type: 'boolean', value: true } }],
        role: { type: 'role', value: 'none' },
      },
    ];

    assert.throws(
      () => buildTreeFromRawNodes(rawNodes),
      /No root node found/,
      'Should throw when all nodes are ignored'
    );
  });

  test('handles empty node array', () => {
    const rawNodes: Protocol.Accessibility.AXNode[] = [];

    assert.throws(
      () => buildTreeFromRawNodes(rawNodes),
      /No root node found/,
      'Should throw for empty array'
    );
  });
});

describe('parseQueryPattern', () => {
  test('parses single field pattern', () => {
    const pattern = parseQueryPattern('role:button');

    assert.equal(pattern.role, 'button');
    assert.equal(pattern.name, undefined);
    assert.equal(pattern.description, undefined);
  });

  test('parses multiple field pattern with AND logic', () => {
    const pattern = parseQueryPattern('role:button name:Submit');

    assert.equal(pattern.role, 'button');
    assert.equal(pattern.name, 'Submit');
  });

  test('parses all three fields', () => {
    const pattern = parseQueryPattern('role:button name:Submit description:Primary');

    assert.equal(pattern.role, 'button');
    assert.equal(pattern.name, 'Submit');
    assert.equal(pattern.description, 'Primary');
  });

  test('handles values with spaces (takes first word)', () => {
    const pattern = parseQueryPattern('role:button name:Submit Form');

    assert.equal(pattern.role, 'button');
    assert.equal(pattern.name, 'Submit');
  });

  test('handles description shorthand (desc)', () => {
    const pattern = parseQueryPattern('desc:Main');

    assert.equal(pattern.description, 'Main');
  });

  test('handles values with colons', () => {
    const pattern = parseQueryPattern('name:Click:Me');

    assert.equal(pattern.name, 'Click:Me');
  });

  test('ignores invalid fields', () => {
    const pattern = parseQueryPattern('invalid:value role:button');

    assert.equal(pattern.role, 'button');
    assert.equal(Object.keys(pattern).length, 1, 'Should only include valid fields');
  });

  test('returns empty object for invalid pattern', () => {
    const pattern = parseQueryPattern('invalid:value');

    assert.deepEqual(pattern, {});
  });

  test('is case-insensitive for field names', () => {
    const pattern = parseQueryPattern('ROLE:button Name:Submit DESC:Primary');

    assert.equal(pattern.role, 'button');
    assert.equal(pattern.name, 'Submit');
    assert.equal(pattern.description, 'Primary');
  });
});

describe('queryA11yTree', () => {
  const tree: A11yTree = {
    root: {
      nodeId: '1',
      role: 'RootWebArea',
      name: 'Test Page',
    },
    nodes: new Map([
      ['1', { nodeId: '1', role: 'RootWebArea', name: 'Test Page' }],
      ['2', { nodeId: '2', role: 'button', name: 'Submit Form', focusable: true }],
      ['3', { nodeId: '3', role: 'button', name: 'Cancel', focusable: true }],
      ['4', { nodeId: '4', role: 'textbox', name: 'Email Address', required: true }],
      ['5', { nodeId: '5', role: 'textbox', name: 'Password', required: true }],
    ]),
    count: 5,
  };

  test('queries by role only', () => {
    const result = queryA11yTree(tree, { role: 'button' });

    assert.equal(result.count, 2, 'Should find both buttons');
    assert.equal(result.nodes.length, 2);
    assert.ok(
      result.nodes.every((n) => n.role === 'button'),
      'All results should be buttons'
    );
  });

  test('queries by name only', () => {
    const result = queryA11yTree(tree, { name: 'Email' });

    assert.equal(result.count, 1);
    assert.ok(result.nodes[0]);
    assert.equal(result.nodes[0].name, 'Email Address');
  });

  test('queries with AND logic (role + name)', () => {
    const result = queryA11yTree(tree, { role: 'button', name: 'Submit' });

    assert.equal(result.count, 1);
    assert.ok(result.nodes[0]);
    assert.equal(result.nodes[0].name, 'Submit Form');
    assert.equal(result.nodes[0].role, 'button');
  });

  test('name matching is case-insensitive', () => {
    const result = queryA11yTree(tree, { name: 'submit' });

    assert.equal(result.count, 1);
    assert.ok(result.nodes[0]);
    assert.equal(result.nodes[0].name, 'Submit Form');
  });

  test('name matching is substring match', () => {
    const result = queryA11yTree(tree, { name: 'Form' });

    assert.equal(result.count, 1);
    assert.ok(result.nodes[0]);
    assert.equal(result.nodes[0].name, 'Submit Form');
  });

  test('role matching is case-insensitive', () => {
    const result = queryA11yTree(tree, { role: 'BUTTON' });

    assert.equal(result.count, 2);
  });

  test('returns empty result when no matches', () => {
    const result = queryA11yTree(tree, { role: 'heading' });

    assert.equal(result.count, 0);
    assert.equal(result.nodes.length, 0);
  });

  test('returns query pattern in result', () => {
    const pattern = { role: 'button', name: 'Submit' };
    const result = queryA11yTree(tree, pattern);

    assert.deepEqual(result.pattern, pattern);
  });

  test('queries by description', () => {
    const treeWithDesc: A11yTree = {
      root: { nodeId: '1', role: 'button', name: 'Click' },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'button', name: 'Click', description: 'Primary action' }],
        ['2', { nodeId: '2', role: 'button', name: 'Cancel', description: 'Secondary action' }],
      ]),
      count: 2,
    };

    const result = queryA11yTree(treeWithDesc, { description: 'Primary' });

    assert.equal(result.count, 1);
    assert.ok(result.nodes[0]);
    assert.equal(result.nodes[0].description, 'Primary action');
  });

  test('handles nodes without name field', () => {
    const treeWithoutNames: A11yTree = {
      root: { nodeId: '1', role: 'generic' },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'generic' }],
        ['2', { nodeId: '2', role: 'button', name: 'Submit' }],
      ]),
      count: 2,
    };

    const result = queryA11yTree(treeWithoutNames, { name: 'Submit' });

    assert.equal(result.count, 1);
    assert.ok(result.nodes[0]);
    assert.equal(result.nodes[0].name, 'Submit');
  });
});
