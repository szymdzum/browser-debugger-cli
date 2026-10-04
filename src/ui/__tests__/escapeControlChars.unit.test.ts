/**
 * Unit tests for terminal-safe text output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OutputFormatter, escapeControlChars } from '@/ui/formatting.js';

void describe('escapeControlChars', () => {
  void it('escapes terminal control sequences but keeps newlines and tabs', () => {
    assert.equal(escapeControlChars('\u001b]0;pwned\u0007ok'), '\\u001b]0;pwned\\u0007ok');
    assert.equal(escapeControlChars('a\tb\nc'), 'a\tb\nc');
    assert.equal(escapeControlChars('\r\u009b'), '\\u000d\\u009b');
    assert.equal(escapeControlChars('zażółć 🚀'), 'zażółć 🚀');
  });

  void it('applies to all formatter output', () => {
    const output = new OutputFormatter().text('page says \u001b[2J').build();
    assert.equal(output, 'page says \\u001b[2J');
  });
});
