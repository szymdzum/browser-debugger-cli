/**
 * Text of a web component as the flat tree renders it: what its shadow root
 * shows (its own labels, fallback content, slotted light-DOM content in place
 * of its slots), with blocks set apart and hidden parts left out, which
 * `innerText` misses.
 *
 * The page script runs here in an isolated VM context on a small node-like
 * tree.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { COMPOSED_JS, FLAT_TEXT_JS } from '@/runtime/dom/elementInfo.js';
import { FILTER_MATCHING_JS } from '@/runtime/dom/targetNode.js';

/** Computed style the page script reads */
interface FakeStyle {
  display: string;
  visibility: string;
}

/** Node-like object the page script reads */
interface FakeNode {
  nodeType: number;
  localName?: string;
  data?: string;
  display?: string;
  visibility?: string;
  hidden?: boolean;
  childNodes: FakeNode[];
  shadowRoot?: { childNodes: FakeNode[] } | null;
  innerText?: string;
  textContent?: string;
  ownerDocument?: typeof DOCUMENT;
  checkVisibility?: () => boolean;
  assignedNodes?: () => FakeNode[];
}

/** Tree walker over the light-DOM element descendants of a node */
interface FakeWalker {
  currentNode: FakeNode | null;
  nextNode: () => FakeNode | null;
}

const DOCUMENT = {
  defaultView: {
    getComputedStyle: (node: FakeNode): FakeStyle => ({
      display: node.display ?? 'block',
      visibility: node.visibility ?? 'visible',
    }),
  },
  createTreeWalker: (root: FakeNode): FakeWalker => {
    const elements = lightElements(root);
    const walker: FakeWalker = {
      currentNode: root,
      nextNode: () => (walker.currentNode = elements.shift() ?? null),
    };
    return walker;
  },
};

/**
 * The light-DOM element descendants of a node, in tree order.
 *
 * @param node - Node
 * @returns Elements under it
 */
function lightElements(node: FakeNode): FakeNode[] {
  return node.childNodes
    .filter((child) => child.nodeType === 1)
    .flatMap((child) => [child, ...lightElements(child)]);
}

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
 * The `innerText` of a node, which follows neither shadow roots nor slots
 * (visibility is not inherited here).
 *
 * @param node - Node
 * @returns Text of its own text nodes and rendered children
 */
function ownText(node: FakeNode): string {
  if (node.nodeType === 3) return node.data ?? '';
  if (node.hidden || node.visibility === 'hidden') return '';
  return node.childNodes.map(ownText).join('');
}

/**
 * An element.
 *
 * @param localName - Tag name
 * @param childNodes - Light-DOM children
 * @param options - Computed display and visibility, whether it is rendered, its shadow root content
 * @returns Node
 */
function element(
  localName: string,
  childNodes: FakeNode[],
  options: { display?: string; visibility?: string; hidden?: boolean; shadow?: FakeNode[] } = {}
): FakeNode {
  const { shadow, ...style } = options;
  const self: FakeNode = { nodeType: 1, localName, childNodes, ...style };
  self.ownerDocument = DOCUMENT;
  self.shadowRoot = shadow ? { childNodes: shadow } : null;
  self.checkVisibility = () => !self.hidden && self.display !== 'contents';
  self.innerText = ownText(self);
  self.textContent = childNodes.map((child) => child.textContent ?? child.data ?? '').join('');
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

const context = { NodeFilter: { SHOW_ELEMENT: 1 } };
const flatText = vm.runInNewContext(`(${FLAT_TEXT_JS})`, context) as (
  el: FakeNode,
  limit: number
) => string;
const composed = vm.runInNewContext(`(${COMPOSED_JS})`, context) as (el: FakeNode) => boolean;
const { passesAll } = vm.runInNewContext(`(${FILTER_MATCHING_JS})([])`, context) as {
  passesAll: (el: FakeNode, filters: { kind: string; text: string }[]) => boolean;
};

/**
 * Text with whitespace collapsed, as previews show it.
 *
 * @param value - Text
 * @returns Collapsed text
 */
function collapsed(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * A card component: a title slot in a header and a default slot in a body.
 *
 * @param light - Light-DOM children
 * @param title - Nodes assigned to the title slot
 * @param body - Nodes assigned to the default slot
 * @returns Host element
 */
function card(light: FakeNode[], title: FakeNode[], body: FakeNode[]): FakeNode {
  return element('x-card', light, {
    shadow: [
      element('header', [slot(title, [text('Fallback title')])]),
      element('div', [slot(body, [text('Fallback body')])]),
    ],
  });
}

void describe('FLAT_TEXT_JS', () => {
  void it('reads the assigned light-DOM content of a slot inside the element', () => {
    const p = element('p', [
      text('Note: '),
      slot([text('Slotted '), element('b', [text('note')], { display: 'inline' }), text(' text')]),
    ]);
    assert.equal(flatText(p, 2000), 'Note: Slotted note text');
  });

  void it('reads a slot itself and sets block elements apart', () => {
    const own = slot([element('div', [text('One')]), element('div', [text('Two')])]);
    assert.equal(collapsed(flatText(own, 2000)), 'One Two');
  });

  void it('reads a host from its shadow root, slotted blocks set apart', () => {
    const title = element('span', [text('Named Title')], { display: 'inline' });
    const body = text('Default body');
    assert.equal(
      collapsed(flatText(card([title, body], [title], [body]), 2000)),
      'Named Title Default body'
    );
  });

  void it('reads the fallback content of slots nothing is assigned to', () => {
    assert.equal(collapsed(flatText(card([], [], []), 2000)), 'Fallback title Fallback body');
  });

  void it('reads text a shadow root draws without a slot, not the light DOM it hides', () => {
    const host = element('x-label', [text('Light text never shown')], {
      shadow: [element('em', [text('Shadow only text')], { display: 'inline' })],
    });
    assert.equal(flatText(host, 2000), 'Shadow only text');
  });

  void it('reads a component nested in an ordinary element', () => {
    const host = element('x-label', [], { display: 'inline', shadow: [text('Inner label')] });
    const div = element('div', [text('Before '), element('span', [host], { display: 'inline' })]);
    assert.equal(flatText(div, 2000), 'Before Inner label');
  });

  void it('leaves out elements that are not rendered and text under visibility: hidden', () => {
    const hiddenTitle = element('span', [text('Hidden')], { hidden: true });
    const p = element('p', [
      slot([text('Shown'), hiddenTitle]),
      element('span', [text('Invisible')], { display: 'inline', visibility: 'hidden' }),
    ]);
    assert.equal(flatText(p, 2000), 'Shown');
  });

  void it('sets lines apart at a <br>', () => {
    const p = element('p', [
      slot([text('One'), element('br', [], { display: 'inline' }), text('Two')]),
    ]);
    assert.equal(collapsed(flatText(p, 2000)), 'One Two');
  });

  void it('cuts the text at the limit', () => {
    const p = element('p', [slot([text('a'.repeat(10)), text('b'.repeat(10))])]);
    assert.equal(flatText(p, 5), 'a'.repeat(5));
  });
});

void describe('COMPOSED_JS', () => {
  void it('finds hosts and slots in an element or under it, and nothing in plain HTML', () => {
    const host = element('x-label', [], { shadow: [text('Label')] });
    assert.equal(composed(host), true);
    assert.equal(composed(element('div', [element('p', [host])])), true);
    assert.equal(composed(element('div', [element('p', [slot([])])])), true);
    assert.equal(composed(element('div', [element('p', [text('Plain')])])), false);
  });

  void it('never reads what a user typed into a field or editor inside a component', () => {
    const editor = element('div', [text('typed secret note')]);
    (editor as FakeNode & { isContentEditable: boolean }).isContentEditable = true;
    const input = element('input', [text('should not show')]);
    const host = element('x-editor', [], {
      shadow: [element('label', [text('Notes')], { display: 'block' }), editor, input],
    });
    assert.equal(flatText(host, 2000).trim(), 'Notes');
  });

  void it('collapses the whitespace of raw text as innerText does', () => {
    const host = element('x-card', [], { shadow: [text('  Two\n    words  ')] });
    assert.equal(flatText(host, 2000), ' Two words ');
  });
});

void describe('FILTER_MATCHING_JS text filters', () => {
  void it('match the text a component shows from its shadow root, not the light DOM it hides', () => {
    const host = element('x-btn', [text('Light text never shown')], {
      shadow: [element('button', [text('Save draft')], { display: 'inline-block' })],
    });
    assert.equal(passesAll(host, [{ kind: 'has-text', text: 'save' }]), true);
    assert.equal(passesAll(host, [{ kind: 'text-is', text: 'Save draft' }]), true);
    assert.equal(passesAll(host, [{ kind: 'has-text', text: 'light' }]), false);
  });

  void it('match slotted content in place of its slot', () => {
    const host = element('x-button', [text('Ok, got it')], {
      shadow: [element('button', [slot([text('Ok, got it')])], { display: 'inline-block' })],
    });
    assert.equal(passesAll(host, [{ kind: 'text-is', text: 'Ok, got it' }]), true);
  });
});
