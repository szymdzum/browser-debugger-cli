/**
 * Text of an element in a shadow root that shows light-DOM content through a
 * `<slot>` (`<p><slot></slot></p>`) includes that content, which `innerText`
 * leaves out.
 *
 * The page script runs here in an isolated VM context on a small node-like
 * tree.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { SLOTTED_TEXT_JS } from '@/runtime/dom/elementInfo.js';

/** Node-like object the page script reads */
interface FakeNode {
  nodeType: number;
  localName?: string;
  data?: string;
  display?: string;
  hidden?: boolean;
  childNodes: FakeNode[];
  assigned?: FakeNode[];
  innerText?: string;
  ownerDocument?: { defaultView: { getComputedStyle: (node: FakeNode) => { display: string } } };
  checkVisibility?: () => boolean;
  querySelector?: (selector: string) => FakeNode | null;
  assignedNodes?: () => FakeNode[];
}

const DOCUMENT = {
  defaultView: { getComputedStyle: (node: FakeNode) => ({ display: node.display ?? 'block' }) },
};

/**
 * A text node.
 *
 * @param data - Its text
 * @returns Node
 */
function text(data: string): FakeNode {
  return { nodeType: 3, data, childNodes: [] };
}

/**
 * A slot in the same tree among the descendants of a node (not its slotted content).
 *
 * @param node - Node
 * @returns The first slot, or null
 */
function findSlot(node: FakeNode): FakeNode | null {
  for (const child of node.childNodes) {
    if (child.localName === 'slot') return child;
    const found = findSlot(child);
    if (found) return found;
  }
  return null;
}

/**
 * The `innerText` of a node, which does not follow slots.
 *
 * @param node - Node
 * @returns Text of its own text nodes and children
 */
function ownText(node: FakeNode): string {
  if (node.nodeType === 3) return node.data ?? '';
  if (node.hidden) return '';
  return node.childNodes.map(ownText).join('');
}

/**
 * An element.
 *
 * @param localName - Tag name
 * @param childNodes - Children
 * @param options - Computed display and whether it is rendered
 * @returns Node
 */
function element(
  localName: string,
  childNodes: FakeNode[],
  options: { display?: string; hidden?: boolean } = {}
): FakeNode {
  const self: FakeNode = { nodeType: 1, localName, childNodes, ...options };
  self.ownerDocument = DOCUMENT;
  self.checkVisibility = () => !self.hidden && self.display !== 'contents';
  self.querySelector = () => findSlot(self);
  self.innerText = ownText(self);
  return self;
}

/**
 * A slot showing the nodes assigned to it, or its fallback children.
 *
 * @param assigned - Assigned nodes
 * @param fallback - Fallback content
 * @returns Node
 */
function slot(assigned: FakeNode[], fallback: FakeNode[] = []): FakeNode {
  const self = element('slot', fallback, { display: 'contents' });
  self.assignedNodes = () => (assigned.length > 0 ? assigned : fallback);
  return self;
}

const slottedText = vm.runInNewContext(`(${SLOTTED_TEXT_JS})`) as (
  el: FakeNode,
  limit: number
) => string;

void describe('SLOTTED_TEXT_JS', () => {
  void it('reads the assigned light-DOM content of a slot inside the element', () => {
    const p = element('p', [
      text('Note: '),
      slot([text('Slotted '), element('b', [text('note')], { display: 'inline' }), text(' text')]),
    ]);
    assert.equal(slottedText(p, 2000), 'Note: Slotted note text');
  });

  void it('reads the fallback content of a slot nothing is assigned to', () => {
    assert.equal(slottedText(element('p', [slot([], [text('fallback')])]), 2000), 'fallback');
  });

  void it('reads a slot itself and sets block elements apart', () => {
    const own = slot([element('div', [text('One')]), element('div', [text('Two')])]);
    assert.equal(slottedText(own, 2000).trim().split(/\s+/).join(' '), 'One Two');
  });

  void it('leaves out elements that are not rendered', () => {
    const p = element('p', [
      slot([text('Shown'), element('span', [text('Hidden')], { hidden: true })]),
    ]);
    assert.equal(slottedText(p, 2000), 'Shown');
  });

  void it('cuts the text at the limit', () => {
    const p = element('p', [slot([text('a'.repeat(10)), text('b'.repeat(10))])]);
    assert.equal(slottedText(p, 5), 'a'.repeat(5));
  });
});
