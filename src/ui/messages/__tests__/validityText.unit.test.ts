/**
 * A secret field that blocks a submit is reported by its validity state
 * (#643): `tooShort: at least 8 characters` instead of Chrome's text, which
 * says how many characters the value has.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validityStateText } from '@/ui/messages/commands.js';

void describe('validityStateText', () => {
  void it('names a too-short value with the minlength, never the current length', () => {
    assert.equal(
      validityStateText({ states: ['tooShort'], minLength: 8 }),
      'tooShort: at least 8 characters'
    );
  });

  void it('names a too-long value with the maxlength', () => {
    assert.equal(
      validityStateText({ states: ['tooLong'], maxLength: 12 }),
      'tooLong: at most 12 characters'
    );
  });

  void it('names other states bare, several joined with commas', () => {
    assert.equal(validityStateText({ states: ['valueMissing'] }), 'valueMissing');
    assert.equal(
      validityStateText({ states: ['patternMismatch', 'typeMismatch'] }),
      'patternMismatch, typeMismatch'
    );
    assert.equal(validityStateText({ states: ['rangeUnderflow'] }), 'rangeUnderflow');
  });

  void it('says invalid when no state is set', () => {
    assert.equal(validityStateText({ states: [] }), 'invalid');
  });
});
