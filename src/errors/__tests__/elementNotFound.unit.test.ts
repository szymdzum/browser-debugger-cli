/**
 * Selector "not found" errors keep message and suggestion apart, so JSON
 * envelopes carry a one-line `error` and the advice in `suggestion`.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { elementNotFoundError, noNodesFoundError } from '@/errors/messages.js';

void describe('elementNotFoundError', () => {
  void it('has a one-line message without an "Error:" prefix', () => {
    for (const selector of ['#missing', '[data-id=x]', 'input[name=email]']) {
      const { message } = elementNotFoundError(selector);
      assert.equal(message, `Element not found: ${selector}`);
    }
  });

  void it('suggests the discovery path for attribute selectors', () => {
    assert.match(elementNotFoundError('[data-id=x]').suggestion, /bdg dom query/);
  });

  void it('points to unsearchable places for plain selectors', () => {
    assert.match(elementNotFoundError('#missing').suggestion, /cross-origin iframes/);
  });

  void it('points to dom frames and eval --frame for cross-origin iframes', () => {
    for (const suggestion of [
      elementNotFoundError('#editor').suggestion,
      noNodesFoundError("a[title='x']").suggestion,
    ]) {
      assert.match(suggestion, /bdg dom frames/);
      assert.match(suggestion, /bdg dom eval --frame <n> '/);
    }
    assert.ok(
      noNodesFoundError("a[title='x']").suggestion.includes(
        `bdg dom eval --frame <n> 'document.querySelector("a[title='\\''x'\\'']")'`
      )
    );
  });
});
