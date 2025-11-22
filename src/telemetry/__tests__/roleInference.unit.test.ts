/**
 * Unit tests for role inference utilities.
 *
 * Tests the contract of pure functions:
 * - inferRoleFromTag: HTML tag to ARIA role mapping
 * - synthesizeA11yNode: A11yNode synthesis from DOM context
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { inferRoleFromTag, synthesizeA11yNode } from '@/telemetry/roleInference.js';

describe('inferRoleFromTag', () => {
  test('maps interactive elements correctly', () => {
    assert.equal(inferRoleFromTag('a'), 'link');
    assert.equal(inferRoleFromTag('button'), 'button');
    assert.equal(inferRoleFromTag('input'), 'textbox');
    assert.equal(inferRoleFromTag('select'), 'combobox');
    assert.equal(inferRoleFromTag('textarea'), 'textbox');
    assert.equal(inferRoleFromTag('option'), 'option');
  });

  test('maps heading elements correctly', () => {
    assert.equal(inferRoleFromTag('h1'), 'heading');
    assert.equal(inferRoleFromTag('h2'), 'heading');
    assert.equal(inferRoleFromTag('h3'), 'heading');
    assert.equal(inferRoleFromTag('h4'), 'heading');
    assert.equal(inferRoleFromTag('h5'), 'heading');
    assert.equal(inferRoleFromTag('h6'), 'heading');
  });

  test('maps landmark elements correctly', () => {
    assert.equal(inferRoleFromTag('nav'), 'navigation');
    assert.equal(inferRoleFromTag('main'), 'main');
    assert.equal(inferRoleFromTag('header'), 'banner');
    assert.equal(inferRoleFromTag('footer'), 'contentinfo');
    assert.equal(inferRoleFromTag('aside'), 'complementary');
    assert.equal(inferRoleFromTag('section'), 'region');
    assert.equal(inferRoleFromTag('article'), 'article');
    assert.equal(inferRoleFromTag('form'), 'form');
  });

  test('maps media elements correctly', () => {
    assert.equal(inferRoleFromTag('img'), 'image');
    assert.equal(inferRoleFromTag('figure'), 'figure');
    assert.equal(inferRoleFromTag('video'), 'video');
    assert.equal(inferRoleFromTag('audio'), 'audio');
  });

  test('maps list elements correctly', () => {
    assert.equal(inferRoleFromTag('ul'), 'list');
    assert.equal(inferRoleFromTag('ol'), 'list');
    assert.equal(inferRoleFromTag('li'), 'listitem');
    assert.equal(inferRoleFromTag('dl'), 'list');
    assert.equal(inferRoleFromTag('dt'), 'term');
    assert.equal(inferRoleFromTag('dd'), 'definition');
  });

  test('maps table elements correctly', () => {
    assert.equal(inferRoleFromTag('table'), 'table');
    assert.equal(inferRoleFromTag('tr'), 'row');
    assert.equal(inferRoleFromTag('th'), 'columnheader');
    assert.equal(inferRoleFromTag('td'), 'cell');
  });

  test('is case-insensitive', () => {
    assert.equal(inferRoleFromTag('BUTTON'), 'button');
    assert.equal(inferRoleFromTag('Button'), 'button');
    assert.equal(inferRoleFromTag('H1'), 'heading');
    assert.equal(inferRoleFromTag('NAV'), 'navigation');
  });

  test('returns generic for unknown tags', () => {
    assert.equal(inferRoleFromTag('div'), 'generic');
    assert.equal(inferRoleFromTag('span'), 'generic');
    assert.equal(inferRoleFromTag('custom-element'), 'generic');
    assert.equal(inferRoleFromTag('unknown'), 'generic');
  });

  test('returns generic for empty string', () => {
    assert.equal(inferRoleFromTag(''), 'generic');
  });
});

describe('synthesizeA11yNode', () => {
  test('creates node with inferred flag set', () => {
    const node = synthesizeA11yNode({ tag: 'button' }, 123);

    assert.equal(node.inferred, true, 'Should have inferred flag');
  });

  test('infers role from tag', () => {
    const buttonNode = synthesizeA11yNode({ tag: 'button' }, 1);
    const linkNode = synthesizeA11yNode({ tag: 'a' }, 2);
    const divNode = synthesizeA11yNode({ tag: 'div' }, 3);

    assert.equal(buttonNode.role, 'button');
    assert.equal(linkNode.role, 'link');
    assert.equal(divNode.role, 'generic');
  });

  test('uses text preview as name', () => {
    const node = synthesizeA11yNode({ tag: 'a', preview: 'Click here' }, 123);

    assert.equal(node.name, 'Click here');
  });

  test('truncates long names', () => {
    const longText = 'A'.repeat(150);
    const node = synthesizeA11yNode({ tag: 'a', preview: longText }, 123);

    assert.ok(node.name, 'Should have name');
    assert.ok(node.name.length <= 100, 'Name should be truncated to 100 chars');
    assert.ok(node.name.endsWith('...'), 'Truncated name should end with ellipsis');
  });

  test('sets nodeId as string', () => {
    const node = synthesizeA11yNode({ tag: 'button' }, 456);

    assert.equal(node.nodeId, '456');
  });

  test('sets backendDOMNodeId', () => {
    const node = synthesizeA11yNode({ tag: 'button' }, 789);

    assert.equal(node.backendDOMNodeId, 789);
  });

  test('adds heading level for h1-h6 tags', () => {
    const h1 = synthesizeA11yNode({ tag: 'h1' }, 1);
    const h2 = synthesizeA11yNode({ tag: 'h2' }, 2);
    const h6 = synthesizeA11yNode({ tag: 'h6' }, 6);

    assert.ok(h1.properties, 'h1 should have properties');
    assert.equal(h1.properties['level'], 1);

    assert.ok(h2.properties, 'h2 should have properties');
    assert.equal(h2.properties['level'], 2);

    assert.ok(h6.properties, 'h6 should have properties');
    assert.equal(h6.properties['level'], 6);
  });

  test('does not add level for non-heading tags', () => {
    const button = synthesizeA11yNode({ tag: 'button' }, 1);
    const div = synthesizeA11yNode({ tag: 'div' }, 2);

    assert.equal(button.properties, undefined);
    assert.equal(div.properties, undefined);
  });

  test('handles missing preview', () => {
    const node = synthesizeA11yNode({ tag: 'button' }, 123);

    assert.equal(node.name, undefined);
  });

  test('handles empty preview', () => {
    const node = synthesizeA11yNode({ tag: 'button', preview: '' }, 123);

    assert.equal(node.name, undefined);
  });

  test('preserves classes in domContext but does not use in node', () => {
    const node = synthesizeA11yNode(
      { tag: 'button', classes: ['btn', 'btn-primary'], preview: 'Submit' },
      123
    );

    // Classes are not copied to A11yNode - they remain in domContext
    assert.equal(node.role, 'button');
    assert.equal(node.name, 'Submit');
  });
});
