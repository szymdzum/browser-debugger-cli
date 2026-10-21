/**
 * The late read of `dom fill` (#892) tells a revert from formatting.
 *
 * The rule is a page script, run here in an isolated VM context on
 * field-like objects.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import { LATE_REVERT_JS } from '@/runtime/dom/reactEventHelpers.js';

const pageRule = vm.runInNewContext(`(${LATE_REVERT_JS})`) as (
  field: Record<string, unknown>,
  check: { el: unknown; expected: string; before: Map<unknown, string>; secret?: boolean }
) => FillValueMismatch | undefined;

/**
 * Run the page-side rule on a field whose value before the fill was `old`,
 * copying its result out of the VM realm.
 *
 * @param field - Field-like object, as read late
 * @param expected - Value given
 * @param old - Value before the fill
 * @param secret - Whether `dom query` masks the field
 * @returns The revert, or undefined for formatting
 */
function lateRevert(
  field: Record<string, unknown>,
  expected: string,
  old: string,
  secret?: boolean
): FillValueMismatch | undefined {
  const before = new Map<unknown, string>([[field, old]]);
  const revert = pageRule(field, { el: field, expected, before, ...(secret && { secret }) });
  return revert && { ...revert };
}

/**
 * Whether the late read counts a text field's value as a revert.
 *
 * @param late - Value read late
 * @param expected - Value given
 * @param old - Value before the fill
 * @returns True for a revert
 */
function reverted(late: string, expected: string, old = ''): boolean {
  return lateRevert({ localName: 'input', type: 'text', value: late }, expected, old) !== undefined;
}

void describe('LATE_REVERT_JS', () => {
  void it('takes any other value as the page formatting the one given', () => {
    assert.equal(reverted('(555) 123-4567', '5551234567'), false);
    assert.equal(reverted('London', 'Lon'), false);
    assert.equal(reverted('ABC', 'abc'), false);
    assert.equal(reverted('abc', ' abc '), false);
    assert.equal(reverted('01/05/2024', '2024-01-05'), false);
    assert.equal(reverted('new', 'new', 'o'), false);
    assert.equal(reverted('Jan 5, 2024', '2024-01-05'), false);
    assert.equal(reverted('5', '05'), false);
    assert.equal(reverted('$1,234.57', '1234.567'), false);
    assert.equal(reverted('xyz', 'new', 'o'), false);
    assert.equal(reverted('ne', 'new', 'o'), false);
    assert.equal(reverted('n/a', '', 'o'), false);
  });

  void it('reports the old value, and a blank field when the value given was not', () => {
    assert.equal(reverted('o', 'new', 'o'), true);
    assert.equal(reverted('hello', 'he', 'hello'), true);
    assert.equal(reverted('', 'new', 'o'), true);
    assert.equal(reverted('  ', 'new', 'o'), true);
    assert.equal(reverted('o', '', 'o'), true);
    assert.equal(reverted('o', 'new', 'o '), true);
    assert.equal(reverted('Old  Value', 'new', ' old value'), true);
  });

  void it('reports any change of a field that is not text-like', () => {
    const checkbox = { localName: 'input', type: 'checkbox', checked: false };
    assert.deepEqual(lateRevert(checkbox, 'checked', 'unchecked'), {
      expected: 'checked',
      actual: 'unchecked',
    });
    const select = { localName: 'select', type: 'select-one', value: 'a', multiple: false };
    assert.deepEqual(lateRevert(select, 'b', 'a'), { expected: 'b', actual: 'a' });
  });

  void it('masks a secret field it reports', () => {
    const field = { localName: 'input', type: 'password', value: '' };
    assert.deepEqual(lateRevert(field, 'hunter22', '', true), {
      expected: '••••',
      actual: '',
      masked: true,
    });
  });
});
