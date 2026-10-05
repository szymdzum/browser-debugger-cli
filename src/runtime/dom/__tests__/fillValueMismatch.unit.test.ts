/**
 * `dom fill` reads the value back and reports when it is not the one given.
 *
 * The check is a page script, run here in an isolated VM context on
 * field-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { withValueMismatchWarning } from '@/runtime/dom/formFillHelpers/shared.js';
import { FILL_VALUE_MISMATCH_JS } from '@/runtime/dom/reactEventHelpers.js';

type Mismatch = { expected: string; actual: string } | undefined;

const pageCheck = vm.runInNewContext(`(${FILL_VALUE_MISMATCH_JS})`) as (
  field: Record<string, unknown>,
  expected: string
) => Mismatch;

/**
 * Run the page-side check, copying its result out of the VM realm.
 *
 * @param field - Field-like object
 * @param expected - Value given to fill
 * @returns Mismatch, or undefined when the value matches
 */
function valueMismatch(field: Record<string, unknown>, expected: string): Mismatch {
  const result = pageCheck(field, expected);
  return result && { ...result };
}

void describe('FILL_VALUE_MISMATCH_JS', () => {
  void it('reports a text field the page emptied or changed', () => {
    assert.deepEqual(valueMismatch({ localName: 'input', type: 'text', value: '' }, 'Lovelace'), {
      expected: 'Lovelace',
      actual: '',
    });
    assert.equal(
      valueMismatch({ localName: 'input', type: 'text', value: 'Ada' }, 'Ada'),
      undefined
    );
  });

  void it('masks passwords, keeping an empty value visible', () => {
    assert.deepEqual(
      valueMismatch({ localName: 'input', type: 'password', value: '' }, 'secret_sauce'),
      { expected: '********', actual: '' }
    );
  });

  void it('compares checkboxes by state and contenteditable text without extra spaces', () => {
    assert.deepEqual(
      valueMismatch({ localName: 'input', type: 'checkbox', checked: false }, 'checked'),
      { expected: 'checked', actual: 'unchecked' }
    );
    assert.equal(
      valueMismatch(
        { localName: 'div', isContentEditable: true, textContent: ' Hello\n world ' },
        'Hello world'
      ),
      undefined
    );
  });

  void it('compares a multiple select by its selected values', () => {
    const selectedOptions = [{ value: 'a' }, { value: 'b' }];
    assert.equal(
      valueMismatch(
        { localName: 'select', type: 'select-multiple', multiple: true, selectedOptions },
        'a, b'
      ),
      undefined
    );
  });
});

void describe('withValueMismatchWarning', () => {
  void it('puts the mismatch first among the warnings', () => {
    const result = withValueMismatchWarning({
      success: true,
      valueMismatch: { expected: 'Lovelace', actual: '' },
      warning: 'The field is hidden; a user could not fill it (the value was set anyway)',
    });
    assert.match(
      result.warning ?? '',
      /^The field's value is "" after filling \(expected "Lovelace"\); the page may have rejected or moved the input; The field is hidden/
    );
  });

  void it('leaves a matching fill alone', () => {
    assert.equal(withValueMismatchWarning({ success: true, value: 'Ada' }).warning, undefined);
  });
});
