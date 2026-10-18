/**
 * Printed logpoint values are cut at the console's text length (#848);
 * `--json` keeps them whole.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import { logpointActionText, logpointHitText } from '@/ui/messages/commands/debug.js';

const LONG = 'x'.repeat(MAX_CONSOLE_TEXT_LENGTH * 5);

void describe('logpoint value text', () => {
  void it('cuts a long value in the action report line', () => {
    const text = logpointActionText({
      id: 'lp1',
      file: 'app.js',
      line: 5,
      values: { s: LONG, n: 1 },
      hits: 1,
    });
    assert.ok(text.length < MAX_CONSOLE_TEXT_LENGTH * 2, `${text.length}`);
    assert.ok(text.includes('…'));
    assert.match(text, / n=1$/);
  });

  void it('cuts a long value in a hit line', () => {
    const text = logpointHitText({ id: 'lp1', ts: 0, values: { s: LONG }, navigationId: 1 });
    assert.ok(text.length < MAX_CONSOLE_TEXT_LENGTH * 2, `${text.length}`);
    assert.ok(text.includes('…'));
  });
});
