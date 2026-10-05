/**
 * `bdg dom wait` condition: when what the page shows meets what is waited for.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isWaitConditionMet,
  needsGoneConfirmation,
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
  return {
    count: 0,
    textCount: 0,
    visibleCount: 0,
    readyState: 'complete',
    documentId: 1,
    ...overrides,
  };
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

  void it('with --gone needs two settled snapshots of one document without (visible) matches', () => {
    const gone = { selector: '#x', gone: true };
    const none = snapshot();
    assert.equal(isWaitConditionMet(snapshot({ count: 1, textCount: 1 }), gone, none), false);
    assert.equal(isWaitConditionMet(none, gone), false);
    assert.equal(isWaitConditionMet(none, gone, none), true);
    const hidden = snapshot({ count: 1, textCount: 1, visibleCount: 0 });
    assert.equal(isWaitConditionMet(hidden, { ...gone, visible: true }, hidden), true);
  });

  void it('with --gone ignores the empty document right after a navigation', () => {
    const gone = { selector: '#spinner', gone: true };
    const before = snapshot({ count: 1, textCount: 1, documentId: 1 });
    const fresh = snapshot({ readyState: 'loading', documentId: 2 });
    const parsed = snapshot({ readyState: 'interactive', documentId: 2 });
    assert.equal(isWaitConditionMet(fresh, gone, before), false);
    assert.equal(needsGoneConfirmation(fresh, gone), false);
    assert.equal(isWaitConditionMet(parsed, gone, fresh), false);
    assert.equal(needsGoneConfirmation(parsed, gone), true);
    assert.equal(isWaitConditionMet(parsed, gone, parsed), true);
    assert.equal(isWaitConditionMet(parsed, gone, snapshot({ documentId: 1 })), false);
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
