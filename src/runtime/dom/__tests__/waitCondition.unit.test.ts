/**
 * `bdg dom wait` condition: when what the page shows meets what is waited for.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isWaitConditionMet,
  normalizeWaitText,
  type WaitSnapshot,
} from '@/runtime/dom/waitCondition.js';

/**
 * A snapshot with defaults (nothing matches, page complete).
 *
 * @param overrides - Fields to set
 * @returns Snapshot
 */
function snapshot(overrides: Partial<WaitSnapshot> = {}): WaitSnapshot {
  return { count: 0, textCount: 0, visibleCount: 0, readyState: 'complete', ...overrides };
}

void describe('isWaitConditionMet', () => {
  void it('waits for a match to appear', () => {
    const condition = { selector: '#finish' };
    assert.equal(isWaitConditionMet(snapshot(), condition), false);
    assert.equal(isWaitConditionMet(snapshot({ count: 1, textCount: 1 }), condition), true);
  });

  void it('with --visible counts only visible matches', () => {
    const condition = { selector: '#finish', visible: true };
    assert.equal(isWaitConditionMet(snapshot({ count: 2, textCount: 2 }), condition), false);
    assert.equal(
      isWaitConditionMet(snapshot({ count: 2, textCount: 2, visibleCount: 1 }), condition),
      true
    );
  });

  void it('with --text counts only matches containing the text', () => {
    const condition = { selector: '#status', text: 'Done' };
    assert.equal(isWaitConditionMet(snapshot({ count: 1 }), condition), false);
    assert.equal(isWaitConditionMet(snapshot({ count: 1, textCount: 1 }), condition), true);
  });

  void it('with --gone waits until nothing (visible) matches', () => {
    assert.equal(
      isWaitConditionMet(snapshot({ count: 1, textCount: 1 }), { selector: '#x', gone: true }),
      false
    );
    assert.equal(isWaitConditionMet(snapshot(), { selector: '#x', gone: true }), true);
    const hidden = snapshot({ count: 1, textCount: 1, visibleCount: 0 });
    assert.equal(isWaitConditionMet(hidden, { selector: '#x', gone: true, visible: true }), true);
  });

  void it('with --load also needs readyState complete', () => {
    const loading = snapshot({ count: 1, textCount: 1, readyState: 'interactive' });
    assert.equal(isWaitConditionMet(loading, { selector: '#x', load: true }), false);
    assert.equal(isWaitConditionMet(loading, { selector: '#x' }), true);
    assert.equal(isWaitConditionMet(snapshot({ readyState: 'loading' }), { load: true }), false);
    assert.equal(isWaitConditionMet(snapshot(), { load: true }), true);
  });
});

void describe('normalizeWaitText', () => {
  void it('collapses whitespace and lowercases like :has-text', () => {
    assert.equal(normalizeWaitText('  Hello\n  World! '), 'hello world!');
  });
});
