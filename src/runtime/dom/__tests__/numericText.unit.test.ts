/**
 * The number a formatted text field shows (#867): `dom fill` compares a
 * plain number given to a text field with it, so `$8.00` or `5.20%` read
 * back is the `8` or `5.2` filled. Ambiguous and locale forms are no number.
 *
 * Page scripts, run here in an isolated VM context.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import { FILL_VALUE_MISMATCH_JS, NUMERIC_TEXT_JS } from '@/runtime/dom/reactEventHelpers.js';

const numericText = vm.runInNewContext(`(${NUMERIC_TEXT_JS})`) as (text: string) => number | null;

const pageCheck = vm.runInNewContext(`(${FILL_VALUE_MISMATCH_JS})`) as (
  field: Record<string, unknown>,
  expected: string,
  secret?: boolean
) => FillValueMismatch | undefined;

/** Read-back text and the number it shows (null: none) */
const TABLE: Array<[string, number | null]> = [
  ['8', 8],
  ['8.00', 8],
  ['-5.2', -5.2],
  ['.5', 0.5],
  ['$8.00', 8],
  ['5.20%', 5.2],
  ['8 %', 8],
  ['$-8', -8],
  ['-$8', -8],
  ['€ 1,234.50', 1234.5],
  ['1,234.5', 1234.5],
  ['1,234,567', 1234567],
  [' 8 €', 8],
  ['12 zł', 12],
  ['¥1,000', 1000],
  ['£ 3', 3],
  ['($5.00)', -5],
  ['(5.00)', -5],
  ['(5,000.25 €)', -5000.25],
  ['(-5)', null],
  ['($-5)', null],
  ['(5', null],
  ['8 PLN', 8],
  ['PLN 8', 8],
  ['USD 8', 8],
  ['EUR -1,234.50', -1234.5],
  ['8 pln', null],
  ['USD 8 PLN', null],
  ['8 PLNX', null],
  ['1 234.50', 1234.5],
  ['1\u00a0234.50', 1234.5],
  ['1\u202f234\u202f567', 1234567],
  ['$1 234.50', 1234.5],
  ['1 234,50', null],
  ['12 34', null],
  ['1 234,567.0', null],
  ['1.234,5', null],
  ['8,00', null],
  ['1,23', null],
  ['1,2345.0', null],
  ['', null],
  ['   ', null],
  ['abc', null],
  ['$', null],
  ['8$8', null],
  ['--8', null],
  ['-$-8', null],
  ['8%%', null],
  ['$8 $', null],
];

void describe('NUMERIC_TEXT_JS', () => {
  for (const [text, number] of TABLE) {
    void it(`reads ${JSON.stringify(text)} as ${String(number)}`, () => {
      assert.equal(numericText(text), number);
    });
  }
});

/**
 * Whether filling `expected` into a field of `type` showing `actual` matches.
 *
 * @param type - Input type
 * @param expected - Value given
 * @param actual - Value read back
 * @returns True when no mismatch
 */
function matches(type: string, expected: string, actual: string): boolean {
  const localName = type === 'textarea' ? 'textarea' : 'input';
  return pageCheck({ localName, type, value: actual }, expected) === undefined;
}

void describe('FILL_VALUE_MISMATCH_JS with a plain number given', () => {
  void it('takes a formatted text field showing the number as a match', () => {
    assert.ok(matches('text', '8', '$8.00'));
    assert.ok(matches('text', '5.2', '5.20%'));
    assert.ok(matches('tel', '1234.5', '1,234.50'));
    assert.ok(matches('textarea', '.5', '0.50'));
    assert.ok(matches('text', '-5', '($5.00)'));
    assert.ok(matches('text', '1234.5', 'PLN 1 234.50'));
  });

  void it('reports another number, a locale form or no number', () => {
    assert.ok(!matches('text', '8', '24.00'));
    assert.ok(!matches('text', '8', '8,00'));
    assert.ok(!matches('text', '8', ''));
  });

  void it('compares a value that is not a plain number exactly', () => {
    assert.ok(!matches('text', '$8', '8'));
    assert.ok(!matches('text', '8 apples', '8'));
    assert.ok(!matches('text', '1,234', '1234'));
  });

  void it('keeps the number comparison of number fields', () => {
    assert.ok(matches('number', '8', '8.0'));
    assert.ok(!matches('number', '8', '24'));
  });
});
