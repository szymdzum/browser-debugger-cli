/**
 * Console output on a busy page: the newest distinct errors and warnings
 * only, and a note when the session dropped its oldest messages.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsoleMessage } from '@/types.js';
import { buildConsoleJsonOutput, formatConsole } from '@/ui/formatters/console.js';

const errors = (count: number): ConsoleMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    type: 'error',
    text: `error ${i}`,
    timestamp: 1000 + i,
    index: 500 + i,
  }));

void describe('console caps', () => {
  void it('lists the newest 50 distinct errors in the summary and says how to see the rest', () => {
    const output = formatConsole(errors(120), { dropped: 500 });
    assert.match(output, /⚠ 500 older console messages were dropped: bdg keeps the newest 10000/);
    assert.match(output, /Errors \(120\)/);
    assert.match(
      output,
      /\(\+70 earlier distinct errors; bdg console --level error --last 0 lists every one\)/
    );
    assert.doesNotMatch(output, /error 69\n/);
    assert.match(output, /error 70\n/);
    assert.match(output, /error 119\n/);
  });

  void it('caps the JSON errors the same way, unless --last asks for more', () => {
    const capped = buildConsoleJsonOutput(errors(120), { dropped: 500 });
    assert.equal(capped.errors.length, 50);
    assert.equal(capped.errors[0]?.text, 'error 70');
    assert.equal(capped.moreErrors, 70);
    assert.equal(capped.dropped, 500);
    const all = buildConsoleJsonOutput(errors(120), { groupLimit: 0 });
    assert.equal(all.errors.length, 120);
    assert.equal(all.moreErrors, undefined);
    assert.equal(all.dropped, undefined);
  });

  void it('notes dropped messages above a list', () => {
    assert.match(
      formatConsole(errors(3), { list: true, last: 0, dropped: 1 }),
      /━\n⚠ 1 older console message was dropped: bdg keeps the newest 10000\n/
    );
  });
});
