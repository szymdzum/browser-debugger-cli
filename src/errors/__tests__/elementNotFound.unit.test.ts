/**
 * Selector "not found" errors keep message and suggestion apart, so JSON
 * envelopes carry a one-line `error` and the advice in `suggestion`.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  elementNotFoundError,
  noNodesFoundError,
  similarSelectorsLine,
  unreachableElementsNote,
} from '@/errors/messages.js';

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

  void it('names only what a checked page has that selectors do not search', () => {
    const none = { crossOriginFrames: false, embeds: false };
    assert.equal(unreachableElementsNote('#x', none), '');
    assert.doesNotMatch(noNodesFoundError('#x', { unsearched: none }).suggestion, /iframe|embed/);
    const frames = unreachableElementsNote('#x', { crossOriginFrames: true, embeds: false });
    assert.match(frames, /^The page has cross-origin iframes, which are not searched\./);
    assert.match(frames, /bdg dom eval --frame <n>/);
    assert.equal(
      unreachableElementsNote('#x', { crossOriginFrames: false, embeds: true }),
      'The page has <object>/<embed> documents, which are not searched.'
    );
  });

  void it('puts similar ids or classes first', () => {
    const similar = similarSelectorsLine('id', ['remove-backpack', 'add-to-cart-bike']);
    assert.equal(
      similar,
      'Did you mean #remove-backpack, #add-to-cart-bike? (similar ids on the page)'
    );
    assert.equal(
      similarSelectorsLine('class', ['btn']),
      'Did you mean .btn? (similar class on the page)'
    );
    assert.equal(similarSelectorsLine('id', []), '');
    assert.match(
      noNodesFoundError('#add-to-cart-backpack', { similar }).suggestion,
      /^Did you mean #remove-backpack/
    );
  });
});
