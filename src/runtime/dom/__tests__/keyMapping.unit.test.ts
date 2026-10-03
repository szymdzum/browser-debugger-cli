/**
 * Key mapping unit tests.
 *
 * Modifier bits must match CDP Input.dispatchKeyEvent:
 * Alt=1, Ctrl=2, Meta/Command=4, Shift=8.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseModifiers } from '@/runtime/dom/keyMapping.js';

void describe('parseModifiers', () => {
  void it('maps each modifier to its CDP bit', () => {
    assert.equal(parseModifiers('alt'), 1);
    assert.equal(parseModifiers('ctrl'), 2);
    assert.equal(parseModifiers('meta'), 4);
    assert.equal(parseModifiers('shift'), 8);
  });

  void it('combines modifiers case-insensitively', () => {
    assert.equal(parseModifiers('Ctrl, SHIFT'), 10);
  });

  void it('returns 0 for no or unknown modifiers', () => {
    assert.equal(parseModifiers(undefined), 0);
    assert.equal(parseModifiers('hyper'), 0);
  });
});
