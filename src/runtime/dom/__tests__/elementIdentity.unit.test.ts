/**
 * Action output names the element itself: its text, else its position among
 * same-looking siblings (`div.figure (2nd of 3)`), and only then an
 * ancestor's text. Text previews leave out close buttons and icons.
 *
 * The descriptions are page scripts, run here in an isolated VM context on a
 * small element-like tree.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import {
  ELEMENT_IDENTITY_JS,
  SIBLING_POSITION_JS,
  WITHOUT_DECORATIONS_JS,
} from '@/runtime/dom/elementInfo.js';

/** Element-like node the page scripts read */
interface FakeNode {
  tagName: string;
  localName: string;
  id: string;
  classList: string[];
  innerText: string;
  textContent: string;
  attributes: Record<string, string>;
  parentElement: FakeNode | null;
  children: FakeNode[];
  isContentEditable: boolean;
  getAttribute: (name: string) => string | null;
  matches: (selector: string) => boolean;
  querySelector: (selector: string) => FakeNode | null;
  querySelectorAll: (selector: string) => FakeNode[];
  contains: (other: FakeNode) => boolean;
}

/**
 * Whether a node matches one simple selector: a tag, `.class`, or
 * `[attr="value"]` (with ` i` for a case-insensitive value).
 *
 * @param node - Node
 * @param selector - Simple selector
 * @returns Whether it matches
 */
function matchesSimple(node: FakeNode, selector: string): boolean {
  if (selector.startsWith('.')) return node.classList.includes(selector.slice(1));
  const attribute = /^\[([\w-]+)="([^"]*)"( i)?\]$/.exec(selector);
  if (attribute) {
    const [, name = '', value = '', insensitive] = attribute;
    const actual = node.attributes[name];
    if (actual === undefined) return false;
    return insensitive ? actual.toLowerCase() === value.toLowerCase() : actual === value;
  }
  return node.localName === selector;
}

/**
 * Build a node and attach its children.
 *
 * @param tag - Tag name
 * @param options - id, classes, text and attributes
 * @param children - Child nodes
 * @returns Node
 */
function node(
  tag: string,
  options: {
    id?: string;
    classes?: string[];
    text?: string;
    attributes?: Record<string, string>;
  } = {},
  children: FakeNode[] = []
): FakeNode {
  const text = options.text ?? children.map((child) => child.innerText).join('');
  const self: FakeNode = {
    tagName: tag.toUpperCase(),
    localName: tag,
    id: options.id ?? '',
    classList: options.classes ?? [],
    innerText: text,
    textContent: text,
    attributes: options.attributes ?? {},
    parentElement: null,
    children,
    isContentEditable: false,
    getAttribute: (name) => self.attributes[name] ?? null,
    matches: (selector) => selector.split(/\s*,\s*/).some((part) => matchesSimple(self, part)),
    querySelector: (selector) => descendants(self).find((n) => n.matches(selector)) ?? null,
    querySelectorAll: (selector) => descendants(self).filter((n) => n.matches(selector)),
    contains: (other) => other === self || descendants(self).includes(other),
  };
  children.forEach((child) => (child.parentElement = self));
  return self;
}

/**
 * All descendants of a node, in document order.
 *
 * @param parent - Node
 * @returns Descendants
 */
function descendants(parent: FakeNode): FakeNode[] {
  return parent.children.flatMap((child) => [child, ...descendants(child)]);
}

const identityOf = vm.runInNewContext(`(${ELEMENT_IDENTITY_JS})`) as (el: FakeNode) => string;
const positionOf = vm.runInNewContext(`(${SIBLING_POSITION_JS})`) as (el: FakeNode) => string;
const withoutDecorations = vm.runInNewContext(`(${WITHOUT_DECORATIONS_JS})`) as (
  el: FakeNode,
  text: string
) => string;

void describe('ELEMENT_IDENTITY_JS', () => {
  void it('describes an element without text by its position among same-looking siblings', () => {
    const figures = [0, 1, 2].map(() => node('div', { classes: ['figure'], text: '' }));
    node('div', { classes: ['example'], text: 'Hovers' }, figures);
    assert.equal(identityOf(figures[1] as FakeNode), 'div.figure (2nd of 3)');
  });

  void it('adds the aria-label to the position', () => {
    const icons = [0, 1, 2].map(() =>
      node('a', { classes: ['icon'], text: '', attributes: { 'aria-label': 'Open' } })
    );
    node('nav', {}, icons);
    assert.equal(identityOf(icons[2] as FakeNode), 'a.icon (3rd of 3) "Open"');
  });

  void it('names a unique element without text by its nearest ancestor with text', () => {
    const toggle = node('input', { classes: ['toggle'], text: '' });
    node('li', { text: 'Buy milk' }, [toggle]);
    assert.equal(identityOf(toggle), 'input.toggle in li "Buy milk"');
  });

  void it('uses the element text first, without a close button glyph', () => {
    const buttons = [node('button', { text: 'Add' }), node('button', { text: 'Add' })];
    node('div', {}, buttons);
    assert.equal(identityOf(buttons[1] as FakeNode), 'button "Add"');
    const close = node('a', { classes: ['close'], text: '×' });
    const flash = node('div', { id: 'flash', text: 'You logged into a secure area!\n×' }, [close]);
    assert.equal(identityOf(flash), 'div#flash "You logged into a secure area!"');
  });
});

void describe('SIBLING_POSITION_JS', () => {
  void it('uses English ordinals and stays empty for an only child', () => {
    const items = Array.from({ length: 23 }, () => node('li'));
    node('ul', {}, items);
    const at = (n: number): string => positionOf(items[n - 1] as FakeNode);
    assert.deepEqual(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(at),
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd'].map(
        (ordinal) => `(${ordinal} of 23)`
      )
    );
    const only = node('span');
    node('p', {}, [only]);
    assert.equal(positionOf(only), '');
  });
});

void describe('WITHOUT_DECORATIONS_JS', () => {
  void it('drops close buttons and aria-hidden icons, but keeps aria-hidden words', () => {
    const icon = node('span', { text: '✓', attributes: { 'aria-hidden': 'true' } });
    const price = node('span', { text: '$10', attributes: { 'aria-hidden': 'true' } });
    const dismiss = node('button', { text: 'Dismiss', attributes: { 'aria-label': 'Dismiss' } });
    const box = node('div', { text: '✓ Saved $10 Dismiss' }, [icon, price, dismiss]);
    assert.equal(withoutDecorations(box, box.innerText).trim(), 'Saved $10');
  });

  void it('drops a button showing just ×', () => {
    const close = node('button', { text: ' × ' });
    const alert = node('div', { text: 'Saved ×' }, [close]);
    assert.equal(withoutDecorations(alert, alert.innerText).trim(), 'Saved');
  });
});
