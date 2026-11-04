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

/** How the late read judges a text field's value (#906) */
type Verdict = 'kept' | 'replaced' | 'restored';

/**
 * The late read's verdict on a text field: the value kept (or formatted),
 * replaced by the page with an unrelated one, or restored (old or blank).
 *
 * @param late - Value read late
 * @param expected - Value given
 * @param old - Value before the fill
 * @returns The verdict
 */
function verdict(late: string, expected: string, old = ''): Verdict {
  const revert = lateRevert({ localName: 'input', type: 'text', value: late }, expected, old);
  if (!revert) return 'kept';
  return (revert as { replaced?: true }).replaced ? 'replaced' : 'restored';
}

/** The design's false-positive matrix (#906): value read late, value given, old value, verdict */
const MATRIX: [late: string, expected: string, old: string, verdict: Verdict][] = [
  ['draft-985004', 'gift wrap, leave at door', 'draft-abc123', 'replaced'],
  ['Enter a note', 'hello there', '', 'replaced'],
  ['Please enter a note', 'please call me', '', 'replaced'],
  ['ord_45c3e1dd', 'my order', '', 'replaced'],
  ['usr_4f9a0c1b', 'John Smith', '', 'replaced'],
  ['N/A', 'new', 'o', 'replaced'],
  ['draft-24915d', 'abc123', '', 'replaced'],
  ['Poland', 'pl', '', 'replaced'],
  ['draft-8e59f5', 'x', '', 'replaced'],
  ['\u2014', 'abc', '', 'replaced'],
  ['Warsaw Ce', 'warsaw central', '', 'replaced'],
  ['Saturday delivery', 'leave at door', '', 'replaced'],
  ['xyz', 'new', 'o', 'replaced'],
  ['ne', 'new', 'o', 'replaced'],
  ['60 min', '1 hour', '', 'replaced'],
  ['Acme', 'Acme Corporation Ltd', '', 'replaced'],
  ['Munich', 'München', '', 'replaced'],
  ['(555) 123-4567', '5551234567', '', 'kept'],
  ['+1 555-123-4567', '5551234567', '', 'kept'],
  ['Jan 5, 2024', '2024-01-05', '', 'kept'],
  ['Nov 5, 2024', '2024-11-05', '', 'kept'],
  ['05/01/2024', '2024-01-05', '', 'kept'],
  ['January 5th, 2024', '2024-01-05', '', 'kept'],
  ['$1,234.50', '1234.5', '', 'kept'],
  ['1234,50\u00a0zł', '1234.5', '', 'kept'],
  ['1\u00a0234,50\u00a0zł', '1234.5', '', 'kept'],
  ['HELLO', 'hello', '', 'kept'],
  ['hello', '  hello  ', '', 'kept'],
  ['Warsaw, Poland', 'war', '', 'kept'],
  ['Warsaw Central Station', 'warsaw central', '', 'kept'],
  ['1 Main Street, Springfield, IL 62701', '1 main st', '', 'kept'],
  ['3.14', '3.14159', '', 'kept'],
  ['3.00', '2.999', '', 'kept'],
  ['Lodz', 'Łódź', '', 'kept'],
  ['Strasse', 'Straße', '', 'kept'],
  ['I like cats', 'I liek cats', '', 'kept'],
  ['https://example.com/', 'example.com', '', 'kept'],
  ['09:30 AM', '930', '', 'kept'],
  ['KOWALSKI, Jan', 'Jan Kowalski', '', 'kept'],
  ['N/A', '---', '', 'kept'],
  ['•••• •••• •••• 1111', '4111111111111111', '', 'kept'],
  ['Enter a note', 'note', '', 'kept'],
  ['draft-2061c1', '1', '', 'kept'],
  ['draft-2024ab', '2024', '', 'kept'],
  ['DRAFT SAVED', 'my draft', 'Draft saved', 'restored'],
  ['o', 'new', 'o', 'restored'],
  ['', 'new', 'o', 'restored'],
];

void describe('LATE_REVERT_JS: formatted or replaced (#906)', () => {
  for (const [late, expected, old, want] of MATRIX) {
    void it(`${JSON.stringify(expected)} read late as ${JSON.stringify(late)}: ${want}`, () => {
      assert.equal(verdict(late, expected, old), want);
    });
  }

  void it('reports a secret field replaced, masked, and keeps a masked rewrite', () => {
    const replaced = { localName: 'input', type: 'password', value: 'N/A' };
    assert.deepEqual(lateRevert(replaced, 'hunter22', '', true), {
      expected: '••••',
      actual: '••••',
      masked: true,
      replaced: true,
    });
    const rewritten = { localName: 'input', type: 'password', value: '•••••••' };
    assert.equal(lateRevert(rewritten, 'hunter22', '', true), undefined);
  });

  void it('keeps the rule for number fields: any later change, rounding too, is a revert', () => {
    const field = { localName: 'input', type: 'number', value: '3.14' };
    assert.deepEqual(lateRevert(field, '3.14159', ''), { expected: '3.14159', actual: '3.14' });
  });
});

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
    assert.equal(reverted('n/a', '', 'o'), false);
    assert.equal(reverted('(555) 123-4567', '5551234567', '(555) 123-4567'), false);
    assert.equal(reverted('(555) 987-6543', '5559876543', '(555) 123-4567'), false);
  });

  void it('reports the old value, and a blank field when the value given was not', () => {
    assert.equal(reverted('o', 'new', 'o'), true);
    assert.equal(reverted('hello', 'he', 'hello'), true);
    assert.equal(reverted('', 'new', 'o'), true);
    assert.equal(reverted('  ', 'new', 'o'), true);
    assert.equal(reverted('o', '', 'o'), true);
    assert.equal(reverted('o', 'new', 'o '), true);
    assert.equal(reverted('Old  Value', 'new', ' old value'), true);
    assert.equal(reverted('(555) 123-4567', '5559876543', '(555) 123-4567'), true);
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
