/**
 * Secrets never leave the page (#346): the form control state `dom query`
 * and `dom get` read leaves out hidden inputs' values and masks sensitive
 * fields, whatever their length.
 *
 * The state script runs here in an isolated VM context on element-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { ELEMENT_STATE_JS, MASKED_VALUE } from '@/runtime/dom/elementInfo.js';

/** What the state script reads of a field */
interface FieldSpec {
  localName?: string;
  type?: string;
  value?: string;
  attributes?: Record<string, string>;
  id?: string;
  textSecurity?: string;
  selected?: string[];
  checked?: boolean;
}

/**
 * Run the state script on an element-like object.
 *
 * @param spec - Field
 * @returns What the page would send
 */
function stateOf(spec: FieldSpec): Record<string, unknown> {
  const attributes = spec.attributes ?? {};
  const el = {
    localName: spec.localName ?? 'input',
    type: spec.type ?? 'text',
    value: spec.value ?? '',
    id: spec.id ?? '',
    checked: spec.checked ?? false,
    selectedOptions: (spec.selected ?? []).map((label) => ({ label })),
    form: null,
    getAttribute: (name: string): string | null => attributes[name] ?? null,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (name: string): string =>
            name === '-webkit-text-security' ? (spec.textSecurity ?? 'none') : '',
        }),
      },
    },
  };
  const read = vm.runInNewContext(`(${ELEMENT_STATE_JS})`) as (el: unknown) => unknown;
  return JSON.parse(JSON.stringify(read(el))) as Record<string, unknown>;
}

void describe('ELEMENT_STATE_JS secrets', () => {
  void it('never sends the value of a hidden input', () => {
    const state = stateOf({ type: 'hidden', value: 'csrf-token-123' });
    assert.deepEqual(state, { type: 'hidden' });
    assert.doesNotMatch(JSON.stringify(state), /csrf/);
  });

  void it('keeps the value of an ordinary field', () => {
    assert.deepEqual(stateOf({ value: 'ada', attributes: { name: 'user' } }), {
      type: 'text',
      value: 'ada',
    });
  });

  void it('masks a password field by its live type or its type attribute, whatever the length', () => {
    const short = stateOf({ type: 'password', value: 'a' });
    const long = stateOf({ type: 'password', value: 'correct horse battery staple' });
    assert.equal(short['value'], MASKED_VALUE);
    assert.equal(long['value'], MASKED_VALUE);
    assert.equal(short['sensitive'], true);
    assert.equal(
      stateOf({ type: 'text', value: 'x', attributes: { type: 'password' } })['value'],
      MASKED_VALUE
    );
    assert.equal(stateOf({ type: 'password', value: '' })['value'], '');
  });

  for (const autocomplete of [
    'cc-number',
    'cc-csc',
    'cc-exp',
    'one-time-code',
    'current-password',
    'new-password',
    'section-pay billing cc-number',
  ]) {
    void it(`masks a field with autocomplete="${autocomplete}"`, () => {
      const state = stateOf({ value: '4111111111111111', attributes: { autocomplete } });
      assert.equal(state['value'], MASKED_VALUE);
      assert.equal(state['sensitive'], true);
    });
  }

  void it('masks a field shown masked by -webkit-text-security', () => {
    assert.equal(stateOf({ value: '1234', textSecurity: 'disc' })['value'], MASKED_VALUE);
    assert.equal(stateOf({ value: '1234', textSecurity: 'none' })['value'], '1234');
  });

  void it('masks a password field switched to text by a "show password" button', () => {
    assert.equal(
      stateOf({ value: 'hunter2', attributes: { name: 'password', type: 'text' } })['value'],
      MASKED_VALUE
    );
    assert.equal(stateOf({ value: 'hunter2', id: 'user-pwd' })['value'], MASKED_VALUE);
    assert.equal(stateOf({ value: '123456', attributes: { name: 'otp' } })['value'], MASKED_VALUE);
    assert.equal(
      stateOf({ value: '123', attributes: { name: 'card-cvc' } })['value'],
      MASKED_VALUE
    );
  });

  void it('masks the selected option of a card select and the text of a secret textarea', () => {
    assert.equal(
      stateOf({
        localName: 'select',
        selected: ['12'],
        attributes: { autocomplete: 'cc-exp-month' },
      })['selected'],
      MASKED_VALUE
    );
    assert.equal(
      stateOf({
        localName: 'textarea',
        value: '123456',
        attributes: { autocomplete: 'one-time-code' },
      })['value'],
      MASKED_VALUE
    );
    assert.equal(stateOf({ localName: 'select', selected: ['Price'] })['selected'], 'Price');
  });
});
