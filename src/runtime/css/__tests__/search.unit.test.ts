/**
 * `css search`: where a text is in a stylesheet and the rule around it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findInSheet } from '@/runtime/css/search.js';

void describe('css search', () => {
  void it('finds every match case-insensitively with its line, column and rule', () => {
    const sheet = ':root {\n  --brand: #06c;\n}\n.btn { color: var(--BRAND); }';
    assert.deepEqual(findInSheet(sheet, '--brand'), {
      total: 2,
      matches: [
        { line: 1, column: 2, rule: ':root { --brand: #06c; }' },
        { line: 3, column: 18, rule: '.btn { color: var(--BRAND); }' },
      ],
    });
    assert.deepEqual(findInSheet(sheet, '--brand', 1).matches.length, 1);
    assert.equal(findInSheet(sheet, '--brand', 1).total, 2);
    assert.deepEqual(findInSheet(sheet, ''), { total: 0, matches: [] });
  });

  void it('cuts the rule around a match in a minified sheet', () => {
    const sheet = `.a{color:red}${'.x{margin:0}'.repeat(40)}.b{color:oklch(50% 0.1 20)}`;
    const [match] = findInSheet(sheet, 'oklch(').matches;
    assert.equal(match?.line, 0);
    assert.equal(match?.rule, '.b{color:oklch(50% 0.1 20)}');
  });
});
