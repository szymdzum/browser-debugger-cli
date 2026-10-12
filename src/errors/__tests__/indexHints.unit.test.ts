/**
 * Index hints (#632): a number that cannot be an index says so, and a list
 * with one entry names its only index instead of "between 0 and 0".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cachedIndexOutOfRangeError,
  indexOutOfRangeError,
  invalidSelectorError,
  tabIndexOutOfRangeError,
} from '@/errors/messages.js';
import type { IndexSource } from '@/types.js';

const SOURCE: IndexSource = { index: 5, command: 'dom query', query: '#legacy-pass' };

void describe('invalidSelectorError for numbers', () => {
  void it('explains that indices are 0-based non-negative integers', () => {
    for (const text of ['-1', '-0', '+1', '1.5', '.5', '-2.25']) {
      const { suggestion } = invalidSelectorError(text, 'SyntaxError');
      assert.match(suggestion, /0-based non-negative integers/, text);
      assert.match(suggestion, /bdg dom query/, text);
    }
  });

  void it('keeps the selector suggestion for anything else', () => {
    for (const text of ['a[', '-foo', '.5col', '#1', 'a1.5']) {
      assert.match(invalidSelectorError(text).suggestion, /Check the selector syntax/, text);
    }
  });
});

void describe('only-index wording', () => {
  void it('says the only index is 0 for one match', () => {
    const { message, suggestion } = indexOutOfRangeError(5, 0);
    assert.equal(message, 'Index 5 out of range (found 1 node)');
    assert.match(suggestion, /the only index is 0/);
    assert.doesNotMatch(suggestion, /between 0 and 0/);
  });

  void it('keeps the range for several matches', () => {
    assert.equal(indexOutOfRangeError(5, 2).suggestion, 'Use an index between 0 and 2');
  });

  void it('does not build a negative range for no matches', () => {
    const { suggestion } = indexOutOfRangeError(0, -1);
    assert.doesNotMatch(suggestion, /-1/);
  });

  void it('says the only index is 0 for a one-entry cached list', () => {
    const { suggestion } = cachedIndexOutOfRangeError(SOURCE, 1);
    assert.match(suggestion, /the only index is 0/);
    assert.doesNotMatch(suggestion, /between 0 and 0/);
  });

  void it('keeps the --limit hint when the list was cut to one entry', () => {
    const { suggestion } = cachedIndexOutOfRangeError({ ...SOURCE, index: 1 }, 1, 3);
    assert.doesNotMatch(suggestion, /between 0 and 0/);
  });
});

void describe('tabIndexOutOfRangeError', () => {
  void it('names the only tab instead of 0-0', () => {
    const tab = { id: 'A', url: 'http://x/', title: 'x', type: 'page' } as never;
    assert.equal(
      tabIndexOutOfRangeError(4, [tab]).message,
      'Tab index 4 out of range (1 tab: the only index is 0)'
    );
    assert.equal(
      tabIndexOutOfRangeError(4, [tab, tab, tab]).message,
      'Tab index 4 out of range (3 tabs: 0-2)'
    );
  });
});
