/**
 * The immediate read-back of `dom fill` judges a value the page rewrote as
 * the late read does (#901): formatting is shown, a return to the old value,
 * a blank or unrelated text is a mismatch.
 *
 * The read-back is a page script, run here in an isolated VM context on
 * field-like objects, with the check the fill leaves on `window`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import type { FillResult } from '@/ipc/protocol/domTypes.js';
import { withLateRead } from '@/runtime/dom/formFillHelpers/fill.js';
import { FILL_READ_BACK_SCRIPT } from '@/runtime/dom/reactEventHelpers.js';

/** A field-like object as the read-back sees it */
type Field = Record<string, unknown>;

/**
 * Run the immediate read-back on a field the fill left, copying its result
 * out of the VM realm.
 *
 * @param field - Field-like object, as read right after the fill
 * @param expected - Value given
 * @param old - Value before the fill
 * @param secret - Whether `dom query` masks the field
 * @returns What the read-back evaluates to
 */
async function readBack(
  field: Field,
  expected: string,
  old = '',
  secret?: boolean
): Promise<Record<string, unknown> | null> {
  const el = { isConnected: true, maxLength: -1, ...field };
  const check = { el, expected, before: new Map<unknown, string>([[el, old]]), secret };
  const read = (await vm.runInNewContext(FILL_READ_BACK_SCRIPT, {
    window: { __bdgFillCheck: check },
    MessageChannel,
  })) as Record<string, unknown> | null;
  return read && { ...read };
}

/**
 * A text input holding a value.
 *
 * @param value - The field's value
 * @returns Field-like object
 */
function text(value: string): Field {
  return { localName: 'input', type: 'text', value };
}

/** Formatting rows of #927 read right after the fill: value shown, value given */
const FORMATTED: [shown: string, expected: string][] = [
  ['SW1A 1AA', 'sw1a 1aa'],
  ['(555) 123-4567', '5551234567'],
  ['+33 6 12 34 56 78', '0612345678'],
  ['4111 1111 1111 1111', '4111111111111111'],
  ['GB82 WEST 1234 5698 7654 32', 'GB82WEST12345698765432'],
  ['Jan 5, 2024', '2024-01-05'],
  ['05/01/2024', '20240105'],
  ['$1,234.50', '1234.5'],
  ['hello', '  hello '],
  ['Warsaw', 'war'],
  ['1 Main Street, Springfield, IL 62701', '1 main st'],
];

/** Replacement rows: value shown, value given, old value */
const REPLACED: [shown: string, expected: string, old: string][] = [
  ['draft-985004', 'gift wrap, leave at door', 'draft-abc123'],
  ['Enter a note', 'hello there', ''],
  ['24.00', '8', ''],
];

void describe('FILL_READ_BACK_SCRIPT judges formatting as the late read does (#901)', () => {
  for (const [shown, expected] of FORMATTED) {
    void it(`${JSON.stringify(expected)} shown as ${JSON.stringify(shown)} is formatting`, async () => {
      assert.deepEqual(await readBack(text(shown), expected), { pageValue: shown });
    });
  }

  for (const [shown, expected, old] of REPLACED) {
    void it(`${JSON.stringify(expected)} shown as ${JSON.stringify(shown)} is replaced`, async () => {
      assert.deepEqual(await readBack(text(shown), expected, old), {
        expected,
        actual: shown,
        replaced: true,
      });
    });
  }

  void it('reports a return to the old value and a blank as before', async () => {
    assert.deepEqual(await readBack(text('Berlin'), 'Paris', 'Berlin'), {
      expected: 'Paris',
      actual: 'Berlin',
    });
    assert.deepEqual(await readBack(text(' berlin'), 'Paris', 'Berlin'), {
      expected: 'Paris',
      actual: ' berlin',
    });
    assert.deepEqual(await readBack(text(''), 'Paris', 'Berlin'), {
      expected: 'Paris',
      actual: '',
    });
  });

  void it('reports a value cut to maxlength as truncated, not replaced', async () => {
    assert.deepEqual(await readBack({ ...text('abc'), maxLength: 3 }, 'abcdef'), {
      expected: 'abcdef',
      actual: 'abc',
      truncatedTo: 3,
    });
  });

  void it('keeps the strict comparison for fields that are not text-like', async () => {
    assert.deepEqual(await readBack({ localName: 'input', type: 'number', value: '24' }, '8'), {
      expected: '8',
      actual: '24',
    });
    assert.deepEqual(
      await readBack({ localName: 'input', type: 'checkbox', checked: false }, 'checked'),
      { expected: 'checked', actual: 'unchecked' }
    );
    assert.deepEqual(await readBack({ localName: 'select', value: 'b' }, 'a'), {
      expected: 'a',
      actual: 'b',
    });
  });

  void it('shows no value of a secret field, and masks one it reports', async () => {
    assert.equal(
      await readBack({ localName: 'input', type: 'password', value: 'ABC123' }, 'abc123'),
      null
    );
    assert.equal(await readBack(text('5551234567'), '555-123-4567', '', true), null);
    assert.deepEqual(
      await readBack({ localName: 'input', type: 'password', value: 'zzzzzzzz' }, 'abc123'),
      { expected: '••••', actual: '••••', masked: true, replaced: true }
    );
  });

  void it('compares a value over 10,000 characters strictly, as before', async () => {
    const read = await readBack(text('x'.repeat(100000)), 'short');
    assert.equal(read?.['replaced'], undefined);
    assert.equal(read?.['actual'], 'x'.repeat(100000));
  });
});

void describe('withLateRead after an immediate read that found formatting (#901)', () => {
  const formatted: FillResult = { success: true, value: '5551234567', pageValue: '(555) 123-4567' };

  void it('fails a formatted value the page reverts later, without the earlier pageValue', () => {
    const late = withLateRead(formatted, { valueMismatch: { expected: '5551234567', actual: '' } });
    assert.deepEqual(late.valueMismatch, { expected: '5551234567', actual: '' });
    assert.equal(late.lateRevert, 'restored');
    assert.equal(late.pageValue, undefined);
  });

  void it('keeps one pageValue, the late one', () => {
    assert.equal(
      withLateRead(formatted, { pageValue: '+1 555-123-4567' }).pageValue,
      '+1 555-123-4567'
    );
  });
});
