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
  disabled?: boolean;
  readOnly?: boolean;
  isContentEditable?: boolean;
  /** Matches `:disabled` (inside a disabled fieldset) */
  fieldsetDisabled?: boolean;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  matches: (selector: string) => boolean;
  closest: (selector: string) => FakeElement | null;
}

/**
 * Whether a fake element matches one of the simple selectors the script uses.
 *
 * @param el - Element
 * @param selector - `[attr]`, `fieldset[disabled]` or `:disabled`
 * @returns Whether it matches
 */
function matchesSimple(el: FakeElement, selector: string): boolean {
  if (selector === ':disabled') return el.disabled === true || el.fieldsetDisabled === true;
  if (selector === 'fieldset[disabled]')
    return el.localName === 'fieldset' && 'disabled' in el.attributes;
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
    ...fields,
    getAttribute: (name) => el.attributes[name] ?? null,
    hasAttribute: (name) => name in el.attributes,
    matches: (selector) => matchesSimple(el, selector),
    closest: (selector) => {
      for (let node: FakeElement | null = el; node; node = node.parent) {
        if (matchesSimple(node, selector)) return node;
      }
      return null;
    },
  };
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
    assert.equal(
      refusal(element('select', { fieldsetDisabled: true }))?.error,
      'The element is disabled'
    );
    const fieldset = element('fieldset', { attributes: { disabled: '' } });
    assert.equal(
      refusal(element('input', { fieldsetDisabled: true, parent: fieldset }))?.error,
      'The element is disabled (inside a disabled <fieldset>)'
    );
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
