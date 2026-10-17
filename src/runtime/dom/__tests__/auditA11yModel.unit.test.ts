/**
 * Unit tests for the accessibility-tree rules of `bdg dom audit a11y` (#455).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { findAxHits } from '@/runtime/dom/auditA11yModel.js';

type AxNode = Protocol.Accessibility.AXNode;

/**
 * An accessibility node.
 *
 * @param id - Node id (also its backend id)
 * @param role - Role
 * @param name - Accessible name
 * @param childIds - Children
 * @param level - Heading level
 * @returns Node
 */
function ax(id: number, role: string, name = '', childIds: number[] = [], level?: number): AxNode {
  return {
    nodeId: String(id),
    ignored: false,
    role: { type: 'role', value: role },
    name: { type: 'computedString', value: name },
    childIds: childIds.map(String),
    backendDOMNodeId: id,
    ...(level !== undefined && {
      properties: [{ name: 'level', value: { type: 'integer', value: level } }],
    }),
  } as AxNode;
}

void describe('findAxHits', () => {
  void it('flags unnamed images and controls, not named ones', () => {
    const hits = findAxHits(
      [
        ax(1, 'RootWebArea', 'p', [2, 3, 4, 5]),
        ax(2, 'image'),
        ax(3, 'image', 'A cat'),
        ax(4, 'button'),
        ax(5, 'textbox', 'Email'),
      ],
      { page: false }
    );
    assert.deepEqual(
      hits.map((hit) => [hit.rule, hit.backendNodeId]),
      [
        ['img-alt', 2],
        ['control-name', 4],
      ]
    );
  });

  void it('flags a skipped heading level, a second h1 and a missing h1 and main', () => {
    const page = findAxHits(
      [
        ax(1, 'RootWebArea', 'p', [2, 3, 4]),
        ax(2, 'heading', 'A', [], 1),
        ax(3, 'heading', 'B', [], 1),
        ax(4, 'heading', 'C', [], 4),
      ],
      { page: true }
    );
    assert.deepEqual(
      page.map((hit) => [hit.rule, hit.reason.kind]),
      [
        ['heading-order', 'extra-h1'],
        ['heading-order', 'skipped-level'],
        ['landmarks', 'no-main'],
      ]
    );
    const none = findAxHits([ax(1, 'RootWebArea', 'p', [2]), ax(2, 'heading', 'A', [], 2)], {
      page: true,
    });
    assert.ok(none.some((hit) => hit.reason.kind === 'no-h1'));
  });

  void it('summarizes text outside landmarks as one hit, none for text inside main', () => {
    const outside = findAxHits(
      [
        ax(1, 'RootWebArea', 'p', [2, 4]),
        ax(2, 'paragraph', '', [3]),
        ax(3, 'StaticText', 'loose'),
        ax(4, 'main', '', [5]),
        ax(5, 'StaticText', 'inside'),
      ],
      { page: true }
    );
    assert.deepEqual(
      outside.filter((hit) => hit.rule === 'landmarks').map((hit) => hit.reason),
      [{ kind: 'outside-landmark', holders: 1 }]
    );
  });
});
