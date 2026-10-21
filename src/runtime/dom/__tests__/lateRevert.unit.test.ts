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
  check: { expected: string; old: string; secret?: boolean }
) => FillValueMismatch | undefined;

/**
 * Whether the late read counts a text field's value as a revert.
 *
 * @param late - Value read late
 * @param expected - Value given
 * @param old - Value before the fill
 * @returns True for a revert
 */
function reverted(late: string, expected: string, old = ''): boolean {
  return (
    pageRule({ localName: 'input', type: 'text', value: late }, { expected, old }) !== undefined
  );
}

void describe('LATE_REVERT_JS', () => {
  void it('takes formatting that keeps the letters and digits given', () => {
    assert.equal(reverted('(555) 123-4567', '5551234567'), false);
    assert.equal(reverted('London', 'Lon'), false);
    assert.equal(reverted('ABC', 'abc'), false);
    assert.equal(reverted('abc', ' abc '), false);
    assert.equal(reverted('01/05/2024', '2024-01-05'), false);
    assert.equal(reverted('new', 'new', 'o'), false);
  });

  void it('reports the old value, an emptied field and an unrelated value', () => {
    assert.equal(reverted('o', 'new', 'o'), true);
    assert.equal(reverted('hello', 'he', 'hello'), true);
    assert.equal(reverted('', 'new', 'o'), true);
    assert.equal(reverted('o', '', 'o'), true);
    assert.equal(reverted('xyz', 'new', 'o'), true);
    assert.equal(reverted('ne', 'new', 'o'), true);
  });

  void it('reports any change of a field that is not text-like', () => {
    const checkbox = { localName: 'input', type: 'checkbox', checked: false };
    assert.deepEqual(
      { ...pageRule(checkbox, { expected: 'checked', old: 'unchecked' }) },
      { expected: 'checked', actual: 'unchecked' }
    );
    const select = { localName: 'select', type: 'select-one', value: 'a', multiple: false };
    assert.deepEqual(
      { ...pageRule(select, { expected: 'b', old: 'a' }) },
      { expected: 'b', actual: 'a' }
    );
  });

  void it('masks a secret field it reports', () => {
    const field = { localName: 'input', type: 'password', value: '' };
    assert.deepEqual(
      { ...pageRule(field, { expected: 'hunter22', old: '', secret: true }) },
      { expected: '••••', actual: '', masked: true }
    );
  });
});
