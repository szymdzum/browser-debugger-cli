/**
 * How a form's invalid fields are reported (#572): page-provided names and
 * validation messages are put on one line and cut, the number of fields is
 * capped, and the text names how many more there were.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { invalidFormMessage } from '@/errors/messages.js';
import { boundInvalidFields } from '@/runtime/dom/blockedSubmit.js';
import { submitBlockedNote } from '@/ui/messages/commands.js';

void describe('invalid fields in reports', () => {
  void it('puts control characters and newlines of names and messages on one line', () => {
    const { fields } = boundInvalidFields([
      { field: 'e\u001b[31mmail', message: 'Line one.\nLine two.\r\n\tEnd.' },
    ]);
    assert.deepEqual(fields, [{ field: 'e [31mmail', message: 'Line one. Line two. End.' }]);
  });

  void it('cuts long names and messages to 200 characters', () => {
    const { fields } = boundInvalidFields([{ field: 'n'.repeat(500), message: 'm'.repeat(5000) }]);
    assert.equal(fields[0]?.field, `${'n'.repeat(199)}…`);
    assert.equal(fields[0]?.message, `${'m'.repeat(199)}…`);
  });

  void it('lists the first 5 fields and counts the rest', () => {
    const all = Array.from({ length: 8 }, (_, i) => ({ field: `f${i}`, message: 'Required.' }));
    const bounded = boundInvalidFields(all);
    assert.deepEqual(
      bounded.fields.map((f) => f.field),
      ['f0', 'f1', 'f2', 'f3', 'f4']
    );
    assert.equal(bounded.omitted, 3);
    assert.equal(
      submitBlockedNote(bounded.fields, bounded.omitted),
      'Submit blocked: f0: Required.; f1: Required.; f2: Required.; f3: Required.; f4: Required.; and 3 more'
    );
    assert.equal(
      invalidFormMessage(bounded.fields.slice(0, 2), 6),
      'Form has invalid fields - f0: Required.; f1: Required.; and 6 more'
    );
  });

  void it('names every field without a note when there are no more', () => {
    const bounded = boundInvalidFields([
      { field: 'email', message: 'Required.' },
      { field: 'pin', message: 'Too short.' },
    ]);
    assert.equal(bounded.omitted, 0);
    assert.equal(
      submitBlockedNote(bounded.fields, bounded.omitted),
      'Submit blocked: email: Required.; pin: Too short.'
    );
  });
});
