/**
 * Key mapping unit tests.
 *
 * Modifier bits must match CDP Input.dispatchKeyEvent:
 * Alt=1, Ctrl=2, Meta/Command=4, Shift=8.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MODIFIER_FLAGS,
  describeModifiers,
  findUnknownModifiers,
  getKeyDefinition,
  impliesShift,
  parseModifiers,
  shortcutCommands,
  similarKeyNames,
} from '@/runtime/dom/keyMapping.js';

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

void describe('modifier names', () => {
  void it('accepts aliases and ignores case and spaces', () => {
    assert.equal(parseModifiers('Cmd, shift'), MODIFIER_FLAGS.meta | MODIFIER_FLAGS.shift);
    assert.equal(parseModifiers('control,option'), MODIFIER_FLAGS.ctrl | MODIFIER_FLAGS.alt);
  });

  void it('reports unknown modifier names', () => {
    assert.deepEqual(findUnknownModifiers('ctrl,bogus,hyper'), ['bogus', 'hyper']);
    assert.deepEqual(findUnknownModifiers('ctrl,shift'), []);
  });

  void it('names flags with the CDP bit meanings', () => {
    assert.deepEqual(describeModifiers(MODIFIER_FLAGS.shift), ['Shift']);
    assert.deepEqual(describeModifiers(MODIFIER_FLAGS.ctrl | MODIFIER_FLAGS.shift), [
      'Ctrl',
      'Shift',
    ]);
    assert.deepEqual(describeModifiers(MODIFIER_FLAGS.alt), ['Alt']);
  });
});

void describe('shortcut commands', () => {
  void it('names the editor command of Ctrl and Cmd shortcuts', () => {
    assert.deepEqual(shortcutCommands('KeyA', MODIFIER_FLAGS.ctrl), ['selectAll']);
    assert.deepEqual(shortcutCommands('KeyA', MODIFIER_FLAGS.meta), ['selectAll']);
    assert.deepEqual(shortcutCommands('KeyZ', MODIFIER_FLAGS.ctrl), ['undo']);
    assert.deepEqual(shortcutCommands('KeyZ', MODIFIER_FLAGS.meta | MODIFIER_FLAGS.shift), [
      'redo',
    ]);
  });

  void it('leaves other keys and combinations alone', () => {
    assert.deepEqual(shortcutCommands('KeyA', 0), []);
    assert.deepEqual(shortcutCommands('KeyA', MODIFIER_FLAGS.shift), []);
    assert.deepEqual(shortcutCommands('KeyA', MODIFIER_FLAGS.ctrl | MODIFIER_FLAGS.alt), []);
    assert.deepEqual(shortcutCommands('KeyB', MODIFIER_FLAGS.ctrl), []);
  });
});

void describe('key names', () => {
  void it('accepts common aliases', () => {
    assert.equal(getKeyDefinition('Esc')?.key, 'Escape');
    assert.equal(getKeyDefinition('Return')?.key, 'Enter');
    assert.equal(getKeyDefinition('Del')?.key, 'Delete');
    assert.equal(getKeyDefinition('up')?.key, 'ArrowUp');
  });

  void it('types shifted digit symbols with Shift', () => {
    assert.equal(getKeyDefinition('!')?.code, 'Digit1');
    assert.equal(impliesShift('!'), true);
    assert.equal(impliesShift('B'), true);
    assert.equal(impliesShift('b'), false);
    assert.equal(getKeyDefinition('!@'), undefined);
    assert.equal(getKeyDefinition(''), undefined);
  });

  void it('suggests the closest key names', () => {
    assert.deepEqual(similarKeyNames('Escpe').slice(0, 1), ['Escape']);
    assert.equal(getKeyDefinition('Escpe'), undefined);
  });
});
