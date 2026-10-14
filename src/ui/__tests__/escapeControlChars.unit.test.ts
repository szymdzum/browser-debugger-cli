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

  void it('escapes bidirectional overrides that disguise text', () => {
    assert.equal(escapeControlChars('file\u202Etxt.exe'), 'file\\u202etxt.exe');
    assert.equal(escapeControlChars('a\u2066b'), 'a\\u2066b');
  });
});

void describe('escapeControlChars on a large text', () => {
  void it('escapes every character class and leaves the rest of 20 million characters alone', () => {
    const text = `${'x'.repeat(20_000_000)}\u0000\u007f\u0085‮⁩\r\n`;
    assert.equal(
      escapeControlChars(text),
      `${'x'.repeat(20_000_000)}\\u0000\\u007f\\u0085\\u202e\\u2069\n`
    );
  });
});
