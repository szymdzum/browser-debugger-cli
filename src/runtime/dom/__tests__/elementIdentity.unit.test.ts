/**
 * Action output names the element itself: its text, else its position among
 * same-looking siblings (`div.figure (2nd of 3)`), and only then an
 * ancestor's text; an element without text by its label or image alt text.
 * Text previews leave out close buttons and icons.
 *
 * The descriptions are page scripts, run here in an isolated VM context on a
 * small element-like tree.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import {
  ELEMENT_DESCRIPTION_JS,
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
  shadowRoot: null;
  labels?: FakeNode[];
  isContentEditable: boolean;
  ownerDocument: typeof DOCUMENT;
  getRootNode: () => typeof DOCUMENT;
  getAttribute: (name: string) => string | null;
  matches: (selector: string) => boolean;
  querySelector: (selector: string) => FakeNode | null;
  querySelectorAll: (selector: string) => FakeNode[];
  contains: (other: FakeNode) => boolean;
}

/** Element tree walker the page script uses to look for shadow hosts and slots */
interface FakeWalker {
  currentNode: FakeNode | null;
  nextNode: () => FakeNode | null;
}

/** Elements by id, for `aria-labelledby` */
const BY_ID = new Map<string, FakeNode>();

const DOCUMENT = {
  createTreeWalker: (root: FakeNode): FakeWalker => {
    const elements = descendants(root);
    const walker: FakeWalker = {
      currentNode: root,
      nextNode: () => (walker.currentNode = elements.shift() ?? null),
    };
    return walker;
  },
  getElementById: (id: string): FakeNode | null => BY_ID.get(id) ?? null,
};

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
  const withAttribute = /^([\w-]+)\[([\w-]+)\]$/.exec(selector);
  if (withAttribute) {
    const [, tag = '', name = ''] = withAttribute;
    return node.localName === tag && node.attributes[name] !== undefined;
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
    shadowRoot: null,
    isContentEditable: false,
    ownerDocument: DOCUMENT,
    getRootNode: () => DOCUMENT,
    getAttribute: (name) => self.attributes[name] ?? null,
    matches: (selector) => selector.split(/\s*,\s*/).some((part) => matchesSimple(self, part)),
    querySelector: (selector) => descendants(self).find((n) => n.matches(selector)) ?? null,
    querySelectorAll: (selector) => descendants(self).filter((n) => n.matches(selector)),
    contains: (other) => other === self || descendants(self).includes(other),
  };
  children.forEach((child) => (child.parentElement = self));
  if (self.id) BY_ID.set(self.id, self);
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

const identityOf = vm.runInNewContext(`(${ELEMENT_IDENTITY_JS})`, {
  NodeFilter: { SHOW_ELEMENT: 1 },
}) as (el: FakeNode) => string;
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

  void it('names an image link by the alt text of its image', () => {
    const logo = node('img', { text: '', attributes: { alt: 'Company logo' } });
    const link = node('a', { id: 'logo', text: '' }, [logo]);
    node('nav', {}, [link]);
    assert.equal(identityOf(link), 'a#logo "Company logo"');
  });

  void it('names a field by its label, or by the element its aria-labelledby points to', () => {
    const user = node('input', { id: 'user', text: '' });
    user.labels = [node('label', { text: 'User ' }, [user])];
    assert.equal(identityOf(user), 'input#user "User"');
    node('span', { id: 'name-label', text: 'What is your name?' });
    const field = node('input', {
      id: 'name',
      text: '',
      attributes: { 'aria-labelledby': 'name-label' },
    });
    node('div', {}, [field]);
    assert.equal(identityOf(field), 'input#name "What is your name?"');
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

void describe('ELEMENT_DESCRIPTION_JS', () => {
  const describeElement = vm.runInNewContext(`(${ELEMENT_DESCRIPTION_JS})`) as (
    el: FakeNode
  ) => string;

  void it('leaves out class fragments of a declaration-like class attribute', () => {
    assert.equal(
      describeElement(node('pre', { classes: ['brush:', 'html', 'notranslate'] })),
      'pre.html.notranslate'
    );
    assert.equal(
      describeElement(node('div', { classes: ['md:flex', 'card'] })),
      'div.md:flex.card'
    );
  });
});
