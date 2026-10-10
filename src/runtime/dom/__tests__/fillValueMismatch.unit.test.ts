/**
 * `dom fill` reads the value back and reports when it is not the one given.
 *
 * The check is a page script, run here in an isolated VM context on
 * field-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import { withValueMismatchWarning } from '@/runtime/dom/formFillHelpers/shared.js';
import { FILL_VALUE_MISMATCH_JS } from '@/runtime/dom/reactEventHelpers.js';
import { valueMismatchWarning } from '@/ui/messages/commands.js';

type Mismatch = FillValueMismatch | undefined;

const pageCheck = vm.runInNewContext(`(${FILL_VALUE_MISMATCH_JS})`) as (
  field: Record<string, unknown>,
  expected: string,
  secret?: boolean
) => Mismatch;

/**
 * Run the page-side check, copying its result out of the VM realm.
 *
 * @param field - Field-like object
 * @param expected - Value given to fill
 * @param secret - Whether `dom query` masks the field
 * @returns Mismatch, or undefined when the value matches
 */
function valueMismatch(
  field: Record<string, unknown>,
  expected: string,
  secret?: boolean
): Mismatch {
  const result = pageCheck(field, expected, secret);
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

  void it('masks passwords and gives their lengths', () => {
    const mismatch = valueMismatch(
      { localName: 'input', type: 'password', value: 'secret' },
      'secret_sauce'
    );
    assert.deepEqual(mismatch, {
      expected: '••••',
      actual: '••••',
      expectedLength: 12,
      actualLength: 6,
    });
    assert.equal(
      valueMismatchWarning(mismatch as FillValueMismatch),
      "The field's value differs from the one filled (masked: length 6, expected 12); the page may have rejected or changed the input"
    );
    assert.equal(
      valueMismatch({ localName: 'input', type: 'password', value: '' }, 'x')?.actual,
      ''
    );
  });

  void it('masks any field dom query masks (#592)', () => {
    assert.deepEqual(valueMismatch({ localName: 'input', type: 'text', value: '12' }, 'ab12', true), {
      expected: '••••',
      actual: '••••',
      expectedLength: 4,
      actualLength: 2,
    });
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

/**
 * Whether a field of an input type holding `actual` matches `expected`.
 *
 * @param type - Input type
 * @param actual - Value the browser holds
 * @param expected - Value given to fill
 * @returns True when no mismatch is reported
 */
function matches(type: string, actual: string, expected: string): boolean {
  const localName = type === 'textarea' ? 'textarea' : 'input';
  return valueMismatch({ localName, type, value: actual }, expected) === undefined;
}

void describe('FILL_VALUE_MISMATCH_JS normalised values', () => {
  void it('compares colors case-insensitively', () => {
    assert.ok(matches('color', '#aabbcc', '#AABBCC'));
    assert.ok(!matches('color', '#000000', '#aabbcc'));
  });

  void it('compares numbers and ranges as numbers', () => {
    assert.ok(matches('number', '1.5', '1.50'));
    assert.ok(matches('range', '7', '07'));
    assert.ok(!matches('number', '', '3'));
  });

  void it('normalises textarea line endings and trims email', () => {
    assert.ok(matches('textarea', 'a\nb', 'a\r\nb'));
    assert.ok(matches('email', 'ada@example.com', ' ada@example.com '));
  });

  void it('takes times without zero seconds and local date-times with T', () => {
    assert.ok(matches('time', '10:00', '10:00:00'));
    assert.ok(matches('datetime-local', '2024-01-05T10:00', '2024-01-05 10:00:00'));
    assert.ok(!matches('time', '10:05', '10:00'));
  });

  void it('reports a value cut to maxlength as truncated', () => {
    const mismatch = valueMismatch(
      { localName: 'input', type: 'text', value: '0123456789', maxLength: 10 },
      '0123456789AB'
    );
    assert.equal(mismatch?.truncatedTo, 10);
    assert.equal(valueMismatchWarning(mismatch), 'The value was cut to 10 characters by maxlength');
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
