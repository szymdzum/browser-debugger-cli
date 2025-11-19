import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { A11yTree, A11yNode } from '@/types.js';
import { semantic } from '@/ui/formatters/semantic.js';

describe('semantic formatter', () => {
  test('formats simple tree with indentation', () => {
    const tree: A11yTree = {
      root: { nodeId: '1', role: 'RootWebArea', name: 'Test Page' },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'RootWebArea', name: 'Test Page', childIds: ['2'] }],
        ['2', { nodeId: '2', role: 'button', name: 'Click me', focusable: true }],
      ]),
      count: 2,
    };

    const output = semantic(tree);

    assert.equal(output, '[RootWebArea] "Test Page"\n  [Button] "Click me" (focusable)');
  });

  test('handles heading levels', () => {
    const tree: A11yTree = {
      root: { nodeId: '1', role: 'heading', properties: { level: '1' } },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'heading', name: 'Main Title', properties: { level: '1' } }],
      ]),
      count: 1,
    };

    const output = semantic(tree);

    assert.equal(output, '[Heading L1] "Main Title"');
  });

  test('shows multiple properties', () => {
    const node: A11yNode = {
      nodeId: '1',
      role: 'textbox',
      name: 'Email',
      focusable: true,
      required: true,
      disabled: false,
    };

    const tree: A11yTree = {
      root: node,
      nodes: new Map([['1', node]]),
      count: 1,
    };

    const output = semantic(tree);

    assert.equal(output, '[Textbox] "Email" (focusable, required)');
  });

  test('omits name when not present', () => {
    const tree: A11yTree = {
      root: { nodeId: '1', role: 'generic' },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'generic', childIds: ['2'] }],
        ['2', { nodeId: '2', role: 'paragraph', name: 'Text' }],
      ]),
      count: 2,
    };

    const output = semantic(tree);

    assert.equal(output, '[Generic]\n  [Paragraph] "Text"');
  });

  test('handles deep nesting', () => {
    const tree: A11yTree = {
      root: { nodeId: '1', role: 'RootWebArea', childIds: ['2'] },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'RootWebArea', childIds: ['2'] }],
        ['2', { nodeId: '2', role: 'main', childIds: ['3'] }],
        ['3', { nodeId: '3', role: 'navigation', childIds: ['4'] }],
        ['4', { nodeId: '4', role: 'link', name: 'Home' }],
      ]),
      count: 4,
    };

    const output = semantic(tree);

    assert.equal(output, '[RootWebArea]\n  [Main]\n    [Navigation]\n      [Link] "Home"');
  });

  test('handles all boolean properties', () => {
    const node: A11yNode = {
      nodeId: '1',
      role: 'button',
      name: 'Submit',
      focusable: true,
      focused: true,
      disabled: true,
      required: true,
    };

    const tree: A11yTree = {
      root: node,
      nodes: new Map([['1', node]]),
      count: 1,
    };

    const output = semantic(tree);

    assert.equal(output, '[Button] "Submit" (focusable, focused, disabled, required)');
  });

  test('handles nodes without children', () => {
    const tree: A11yTree = {
      root: { nodeId: '1', role: 'button', name: 'Click' },
      nodes: new Map([['1', { nodeId: '1', role: 'button', name: 'Click' }]]),
      count: 1,
    };

    const output = semantic(tree);

    assert.equal(output, '[Button] "Click"');
  });

  test('capitalizes role names', () => {
    const tree: A11yTree = {
      root: { nodeId: '1', role: 'navigation' },
      nodes: new Map([
        ['1', { nodeId: '1', role: 'navigation', childIds: ['2'] }],
        ['2', { nodeId: '2', role: 'searchbox', name: 'Search' }],
      ]),
      count: 2,
    };

    const output = semantic(tree);

    assert.equal(output, '[Navigation]\n  [Searchbox] "Search"');
  });
});
