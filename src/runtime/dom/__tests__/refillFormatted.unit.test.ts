/**
 * A re-fill of a field that already shows the page's format of the value
 * (#930): the rule of both reads of `dom fill` (`FILL_REVERT_JS`) passes a
 * field back at its old value only when the whole old value is a format of
 * the value given (an amount, a phone number with its country code, an ISO
 * date written out in the page's locales). Any run of the old value left
 * unexplained keeps the revert.
 *
 * The rule is a page script, run here in an isolated VM context on
 * field-like objects, with the page's `lang` and `navigator.languages`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import { FILL_REVERT_JS } from '@/runtime/dom/reactEventHelpers.js';

/** Page globals of the VM context: the browser's languages, set per row */
const page = { navigator: { languages: [] as string[] } };
const pageRule = vm.runInNewContext(`(${FILL_REVERT_JS})`, page) as (
  field: Record<string, unknown>,
  check: { el: unknown; expected: string; before: Map<unknown, string>; secret?: boolean }
) => FillValueMismatch | undefined;

/** How the rule judges the value: formatting (kept), or a revert (restored, replaced) */
type Verdict = 'kept' | 'restored' | 'replaced';

/** Locales of a page without other settings: `lang="en"`, the headless default languages */
const DEFAULT_LOCALES = ['en', 'en-GB', 'en-US', 'en'];

/**
 * The verdict on a text field whose value before the fill was `old`.
 *
 * @param late - Value read after the fill
 * @param expected - Value given
 * @param old - Value before the fill
 * @param locales - The page's `lang`, then `navigator.languages`
 * @returns The verdict
 */
function verdict(late: string, expected: string, old: string, locales: string[]): Verdict {
  page.navigator.languages = locales.slice(1);
  const field = {
    localName: 'input',
    type: 'text',
    value: late,
    ownerDocument: { documentElement: { lang: locales[0] } },
  };
  const revert = pageRule(field, { el: field, expected, before: new Map([[field, old]]) });
  if (!revert) return 'kept';
  return (revert as { replaced?: true }).replaced ? 'replaced' : 'restored';
}

/** A row: name, value read late, value given, old value (default: the value read late), locales, verdict */
type Row = [
  name: string,
  late: string,
  expected: string,
  old: string | null,
  locales: string[] | null,
  want: Verdict,
];

/** The design matrix of #930 (re-fills: the old value is the one read late unless given) */
const MATRIX: Row[] = [
  ['issue: phone', '+33 6 12 34 56 78', '0612345678', null, null, 'kept'],
  ['issue: decimal comma', '8,00', '8', null, null, 'kept'],
  ['issue: date written out', '10 November 2026', '2026-11-10', null, null, 'kept'],
  ['date en-US short', 'Nov 10, 2026', '2026-11-10', null, null, 'kept'],
  ['date Jan 5', 'Jan 5, 2024', '2024-01-05', null, null, 'kept'],
  ['date single-digit day', '1 November 2026', '2026-11-01', null, null, 'kept'],
  ['date zero-padded day', '05 March 2026', '2026-03-05', null, null, 'kept'],
  ['date en-GB Sept', '10 Sept 2026', '2026-09-10', null, null, 'kept'],
  ['date en-US Sep', '10 Sep 2026', '2026-09-10', null, null, 'kept'],
  ['date de_DE', '10. Oktober 2026', '2026-10-10', null, ['de_DE', 'en-GB', 'en-US', 'en'], 'kept'],
  ['date pl genitive', '10 marca 2026', '2026-03-10', null, ['pl', 'en-GB', 'en-US', 'en'], 'kept'],
  [
    'date ru genitive with г.',
    '10 марта 2026 г.',
    '2026-03-10',
    null,
    ['ru', 'en-GB', 'en-US', 'en'],
    'kept',
  ],
  ['date fr', '10 février 2026', '2026-02-10', null, ['fr', 'en-GB', 'en-US', 'en'], 'kept'],
  ['date fr after an invalid locale', '10 février 2026', '2026-02-10', null, ['x', 'fr'], 'kept'],
  ['date fr after de-', '10 février 2026', '2026-02-10', null, ['de-', 'fr'], 'kept'],
  ['amount 1 234,50', '1 234,50', '1234.5', null, null, 'kept'],
  ['amount 1.234,50', '1.234,50', '1234.5', null, null, 'kept'],
  ["amount CHF 1'234.50", "CHF 1'234.50", '1234.5', null, null, 'kept'],
  ['amount 1’234.50', '1’234.50', '1234.5', null, null, 'kept'],
  ['amount rounded to shown decimals', '3.14', '3.14159', null, null, 'kept'],
  ['amount 0,00', '0,00', '0', null, null, 'kept'],
  ['amount 8.00', '8.00', '8', null, null, 'kept'],
  ['amount 08', '08', '8', null, null, 'kept'],
  ['amount 0,500', '0,500', '0.5', null, null, 'kept'],
  ['phone +33 without separator', '+33612345678', '0612345678', null, null, 'kept'],
  ['phone +33 grouped by 3', '+33 612 345 678', '0612345678', null, null, 'kept'],
  ['phone input without trunk zero', '+33 612 345 678', '612345678', null, null, 'kept'],
  ['phone +1', '+1 555-123-4567', '5551234567', null, null, 'kept'],
  ['phone +44 without trunk zero', '+44 7700 900123', '7700900123', null, null, 'kept'],
  ['phone +44 with trunk zero', '+44 7700 900123', '07700900123', null, null, 'kept'],
  [
    'limit: any country code for an input without one',
    '+1 612 345 678',
    '612345678',
    null,
    null,
    'kept',
  ],
  ['limit: another country code', '+48 612 345 678', '0612345678', null, null, 'kept'],
  ['counterexample 0.00 after 8.00', '0.00', '8.00', null, null, 'restored'],
  ['0.00 after 8', '0.00', '8', null, null, 'restored'],
  ['0,00 after 8.00', '0,00', '8.00', null, null, 'restored'],
  ['0.00 h after 8.00', '0.00 h', '8.00', null, null, 'restored'],
  ['10.50 after 10', '10.50', '10', null, null, 'restored'],
  ['1,000.00 after 100', '1,000.00', '100', null, null, 'restored'],
  ['24.00 after 8', '24.00', '8', null, null, 'restored'],
  ['1,000 after 1', '1,000', '1', null, null, 'restored'],
  ['2,500 after 2.5', '2,500', '2.5', null, null, 'restored'],
  ['12,000 after 12', '12,000', '12', null, null, 'restored'],
  ['1 000 after 1', '1 000', '1', null, null, 'restored'],
  ['unchanged #867 number match: 0,500 over 500', '0,500', '500', null, null, 'kept'],
  ['8 after 8.4', '8', '8.4', null, null, 'restored'],
  ['100 after 100.4', '100', '100.4', null, null, 'restored'],
  ['8 after 7.6', '8', '7.6', null, null, 'restored'],
  ['Max 8 after 8', 'Max 8', '8', null, null, 'restored'],
  ['Qty 8.00 after 8', 'Qty 8.00', '8', null, null, 'restored'],
  ['no unit stripping: 8.00 h after 8', '8.00 h', '8', null, null, 'restored'],
  ['unchanged #867 number match: 8 over 08', '8', '08', null, null, 'kept'],
  ['phone: dropped leading digit', '+33 6 12 34 56 78', '12345678', null, null, 'restored'],
  ['phone: +1 dropped leading digit', '+1 555 123 4567', '551234567', null, null, 'restored'],
  ['phone: two digits dropped', '+33 6 12 34 56 78', '2345678', null, null, 'restored'],
  ['phone: last digit differs', '+1 555 123 4567', '5551234568', null, null, 'restored'],
  ['phone: another number', '+33 6 12 34 56 78', '0699999999', null, null, 'restored'],
  ['phone: shared prefix', '+48 600 999 200', '+48 600 100 200', null, null, 'restored'],
  ['phone: +44 truncated', '+44 7700 900123', '07700 900 12', null, null, 'restored'],
  ['phone: +48 600 truncated', '+48 600 999 200', '+48 600', null, null, 'restored'],
  ['phone: truncated, no country code', '(555) 123-4567', '555123456', null, null, 'restored'],
  ['date: another day', '10 November 2026', '2026-11-01', null, null, 'restored'],
  ['date: day and month swapped', '11 October 2026', '2026-11-10', null, null, 'restored'],
  ['date: another year', '10 November 2025', '2026-11-10', null, null, 'restored'],
  ['date: another year, short', '5 March 2025', '2026-03-05', null, null, 'restored'],
  ['date: 10 November after 2026-10-11', '10 November 2026', '2026-10-11', null, null, 'restored'],
  ['date: Mar 5 after 2026-05-03', 'Mar 5, 2026', '2026-05-03', null, null, 'restored'],
  ['date: dd.mm swapped', '10.11.2026', '11.10.2026', null, null, 'restored'],
  ['date: ISO swapped', '2026-11-10', '2026-10-11', null, null, 'restored'],
  ['date: year only', '2026-11-10', '2026', null, null, 'restored'],
  ['date: weekday', 'Tuesday 10 November 2026', '2026-11-10', null, null, 'restored'],
  ['date: de on an en-only page', '10. Oktober 2026', '2026-10-10', null, null, 'restored'],
  ['date: pl on an en-only page', '10 marca 2026', '2026-03-10', null, null, 'restored'],
  [
    'date: fr with blank locales',
    '10 février 2026',
    '2026-02-10',
    null,
    ['', ' ', 'en-GB', 'en-US', 'en'],
    'restored',
  ],
  ['date: Marketing is no month', 'Marketing 10 2026', '2026-03-10', null, null, 'restored'],
  ['date: Junior is no month', 'Junior 5 2026', '2026-06-05', null, null, 'restored'],
  ['date: Decor is no month', 'Decor 12 2025', '2025-12-12', null, null, 'restored'],
  ['room numbers swapped', 'Room 12 Floor 3', 'Room 3 Floor 12', null, null, 'restored'],
  ['IP prefix', '192.168.1.10', '192.168.1.1', null, null, 'restored'],
  ['order number prefix', 'ORD-12345', 'ORD-1234', null, null, 'restored'],
  ['extra word', 'Jane Smith', 'Jane', null, null, 'restored'],
  ['name reordered', 'Smith, John', 'John Smith', null, null, 'restored'],
  ['district added', 'Warsaw Mokotow', 'Warsaw', null, null, 'restored'],
  ['order 9876 after order 1234', 'order 9876', 'order 1234', null, null, 'restored'],
  [
    'limit: autocomplete re-fill',
    'Warsaw Central Station',
    'warsaw central',
    null,
    null,
    'restored',
  ],
  [
    'limit: address re-fill',
    '1 Main Street, Springfield, IL 62701',
    '1 main st',
    null,
    null,
    'restored',
  ],
  ['limit: short autocomplete re-fill', 'London', 'Lon', null, null, 'restored'],
  ['limit: card mask re-fill', '•••• 1111', '4111111111111111', null, null, 'restored'],
  ['old value keeps a short input', 'hello', 'he', null, null, 'restored'],
  ['old value keeps part of the input', 'DRAFT SAVED', 'my draft', 'Draft saved', null, 'restored'],
  ['old value restored', 'Berlin', 'Paris', null, null, 'restored'],
  ['S30 draft written after every input', 'draft-9f3ac2', 'Jane Smith', null, null, 'restored'],
  ['old value holds the input in a longer token', 'draft-9f3ac2', 'draft', null, null, 'restored'],
  ['short: 10 after 1', '10', '1', null, null, 'restored'],
  ['short: 10 after 0', '10', '0', null, null, 'restored'],
  ['short: an id after 1', 'draft-2061c1', '1', null, null, 'restored'],
  ['re-fill formatted differently', '10 Nov 2026', '2026-11-10', '10 November 2026', null, 'kept'],
  ['first fill of a written-out date', '10 November 2026', '2026-11-10', '', null, 'kept'],
  ['cleared', '', 'shoes', 'o', null, 'restored'],
  ['same digits, another amount: 1,234 after 1.234', '1,234', '1.234', null, null, 'restored'],
  [
    'same digits, another amount: 1.234,5 after 1.2345',
    '1.234,5',
    '1.2345',
    null,
    null,
    'restored',
  ],
  ['same digits, same amount: 12.345 after 12345', '12.345', '12345', null, null, 'kept'],
  ['same digits, no amount: phone re-fill', '(555) 123-4567', '5551234567', null, null, 'kept'],
  ['same digits, another amount: 12.345 after 12,345', '12.345', '12,345', null, null, 'restored'],
  ['same digits, ambiguous amount: 1.234 after 1,234', '1.234', '1,234', null, null, 'restored'],
];

void describe('FILL_REVERT_JS: a re-fill shown in the format of the earlier fill (#930)', () => {
  for (const [name, late, expected, old, locales, want] of MATRIX) {
    void it(`${name}: ${JSON.stringify(expected)} over ${JSON.stringify(old ?? late)} read as ${JSON.stringify(late)} is ${want}`, () => {
      assert.equal(verdict(late, expected, old ?? late, locales ?? DEFAULT_LOCALES), want);
    });
  }

  void it('keeps the strict revert for a secret field back at its old value', () => {
    page.navigator.languages = ['en'];
    const field = { localName: 'input', type: 'password', value: '+33 6 12 34 56 78' };
    const before = new Map([[field, '+33 6 12 34 56 78']]);
    const check = { el: field, expected: '0612345678', before, secret: true };
    assert.deepEqual(
      { ...pageRule(field, check) },
      { expected: '••••', actual: '••••', masked: true }
    );
  });

  void it('reads an old value with a long run of spaces in linear time', () => {
    const field = { localName: 'input', type: 'text', value: '' };
    const timed = (spaces: number): number => {
      const old = `a${' '.repeat(spaces)}b`;
      field.value = old;
      const check = { el: field, expected: '8', before: new Map([[field, old]]) };
      let best = Infinity;
      for (let round = 0; round < 15; round++) {
        const started = process.hrtime.bigint();
        pageRule(field, check);
        best = Math.min(best, Number(process.hrtime.bigint() - started));
      }
      return best;
    };
    timed(2000);
    const ratio = timed(8000) / timed(2000);
    assert.ok(
      ratio < 8,
      `4x the spaces took ${ratio.toFixed(1)}x the time (linear: about 4x, quadratic: about 16x)`
    );
  });
});
