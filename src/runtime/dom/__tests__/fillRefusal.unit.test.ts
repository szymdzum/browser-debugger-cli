/**
 * `dom fill` names why it cannot fill an element: disabled, read-only
 * (attribute, contenteditable="false", aria-readonly), inert, or not a
 * fillable kind of element.
 *
 * The check is a page script, run here in an isolated VM context on
 * element-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { FILL_REFUSALS } from '@/errors/messages.js';
import { FILL_REFUSAL_JS } from '@/runtime/dom/reactEventHelpers.js';

type Refusal = { error: string; suggestion: string } | null;

/** Element-like object the page script reads */
interface FakeElement {
  localName: string;
  tagName: string;
  id: string;
  classList: string[];
  attributes: Record<string, string>;
  parent: FakeElement | null;
  /** Child elements (set by {@link element} from each child's parent) */
  children: FakeElement[];
  disabled?: boolean;
  readOnly?: boolean;
  isContentEditable?: boolean;
  readonly parentElement: FakeElement | null;
  readonly firstElementChild: FakeElement | null;
  readonly nextElementSibling: FakeElement | null;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  contains: (other: FakeElement) => boolean;
  matches: (selector: string) => boolean;
  closest: (selector: string) => FakeElement | null;
}

/**
 * Whether a fake element has the attribute of a `[attr]` selector (the only
 * kind the script still matches).
 *
 * @param el - Element
 * @param selector - `[attr]`
 * @returns Whether it matches
 */
function matchesSimple(el: FakeElement, selector: string): boolean {
  const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
  return attribute !== undefined && attribute in el.attributes;
}

/**
 * Build an element-like object.
 *
 * @param tag - Tag name
 * @param fields - Properties and attributes
 * @returns Element
 */
function element(tag: string, fields: Partial<FakeElement> = {}): FakeElement {
  const el: FakeElement = {
    localName: tag,
    tagName: tag.toUpperCase(),
    id: '',
    classList: [],
    attributes: {},
    parent: null,
    children: [],
    ...fields,
    get parentElement() {
      return el.parent;
    },
    get firstElementChild() {
      return el.children[0] ?? null;
    },
    get nextElementSibling() {
      const siblings = el.parent?.children ?? [];
      return siblings[siblings.indexOf(el) + 1] ?? null;
    },
    getAttribute: (name) => el.attributes[name] ?? null,
    hasAttribute: (name) => name in el.attributes,
    contains: (other) => {
      for (let node: FakeElement | null = other; node; node = node.parent) {
        if (node === el) return true;
      }
      return false;
    },
    matches: (selector) => matchesSimple(el, selector),
    closest: (selector) => {
      for (let node: FakeElement | null = el; node; node = node.parent) {
        if (matchesSimple(node, selector)) return node;
      }
      return null;
    },
  };
  el.parent?.children.push(el);
  return el;
}

const refusalOf = vm.runInNewContext(`(${FILL_REFUSAL_JS})`) as (el: FakeElement) => Refusal;

/**
 * Run the page check, copying its result out of the VM realm.
 *
 * @param el - Element
 * @returns Refusal, or null when the element can be filled
 */
function refusal(el: FakeElement): Refusal {
  const result = refusalOf(el);
  return result && { ...result };
}

void describe('FILL_REFUSAL_JS', () => {
  void it('fills enabled, writable controls and editable content', () => {
    assert.equal(refusal(element('input')), null);
    assert.equal(refusal(element('div', { isContentEditable: true })), null);
  });

  void it('names the disabled attribute or the disabled fieldset', () => {
    assert.equal(
      refusal(element('input', { disabled: true, attributes: { disabled: '' } }))?.error,
      'The element is disabled (disabled attribute)'
    );
    const fieldset = element('fieldset', { attributes: { disabled: '' } });
    assert.equal(
      refusal(element('input', { parent: fieldset }))?.error,
      'The element is disabled (inside a disabled <fieldset>)'
    );
  });

  void it("keeps a field in a disabled fieldset's first legend enabled", () => {
    const fieldset = element('fieldset', { attributes: { disabled: '' } });
    const legend = element('legend', { parent: fieldset });
    assert.equal(refusal(element('input', { parent: legend })), null);
  });

  void it('reads the element itself, not the page-replaceable matches()', () => {
    const lying = element('input');
    lying.matches = () => true;
    assert.equal(refusal(lying), null);
  });

  void it('calls a readonly field read-only', () => {
    assert.deepEqual(refusal(element('textarea', { readOnly: true })), {
      kind: 'readOnly',
      error: 'The element is read-only (readonly attribute)',
      suggestion: FILL_REFUSALS.readOnly.suggestion,
    });
  });

  void it('names contenteditable="false" on the element or the editor around it', () => {
    assert.equal(
      refusal(element('div', { attributes: { contenteditable: 'false' } }))?.error,
      'The element is read-only (contenteditable="false")'
    );
    const editor = element('body', { id: 'tinymce', attributes: { contenteditable: 'false' } });
    assert.equal(
      refusal(element('p', { parent: editor }))?.error,
      'The element is read-only (contenteditable="false" on body#tinymce)'
    );
  });

  void it('names inert, aria-readonly and aria-disabled', () => {
    const inert = element('div', { attributes: { inert: '' } });
    assert.equal(
      refusal(element('div', { parent: inert }))?.error,
      'The element is inert (inside an inert element)'
    );
    assert.equal(
      refusal(element('div', { attributes: { 'aria-readonly': 'true' } }))?.error,
      'The element is read-only (aria-readonly="true")'
    );
    assert.equal(
      refusal(element('div', { attributes: { 'aria-disabled': 'true' } }))?.error,
      'The element is disabled (aria-disabled="true")'
    );
  });

  void it('says when an element is not a fillable kind', () => {
    assert.deepEqual(refusal(element('span')), {
      kind: 'notFillable',
      error:
        'Element is not fillable (<span> is not an input, textarea, select or contenteditable element)',
      suggestion: FILL_REFUSALS.notFillable.suggestion,
    });
  });
});
