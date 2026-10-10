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

  void it('names closed shadow hosts and points to dom a11y query for their elements', () => {
    const help =
      'For an element in a closed shadow root: bdg dom a11y query role=textbox (or another role), then use its index with dom fill, dom click or dom get';
    assert.equal(
      unreachableElementsNote('#x', {
        crossOriginFrames: false,
        embeds: false,
        closedShadowHosts: ['x-vault'],
      }),
      `The page has closed shadow roots (in <x-vault>), which are not searched.\n${help}`
    );
    const many = unreachableElementsNote('#x', {
      crossOriginFrames: true,
      embeds: true,
      closedShadowHosts: ['a-b', 'c-d#pay', 'e-f', 'g-h'],
    });
    assert.match(
      many,
      /^The page has closed shadow roots \(in <a-b>, <c-d#pay>, <e-f>, \+1 more\), cross-origin iframes and <object>\/<embed> documents, which are not searched\./
    );
    assert.ok(many.includes(help));
    assert.match(many, /bdg dom eval --frame <n>/);
    assert.ok(unreachableElementsNote('#x').includes(help), 'an unchecked page names the path too');
  });

  void it('says when the closed host check stopped before the end of the page', () => {
    const stopped = unreachableElementsNote('#x', {
      crossOriginFrames: false,
      embeds: false,
      closedShadowHostsChecked: 20,
    });
    assert.match(
      stopped,
      /^Closed shadow roots were looked for in the first 20 custom elements only \(none there\); selectors do not search them\.\nFor an element in a closed shadow root: bdg dom a11y query/
    );
    const found = unreachableElementsNote('#x', {
      crossOriginFrames: false,
      embeds: false,
      closedShadowHosts: ['x-vault'],
      closedShadowHostsChecked: 20,
    });
    assert.match(found, /^The page has closed shadow roots \(in <x-vault>\)/);
    assert.doesNotMatch(found, /first 20 custom elements/);
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

  void it('explains that ::part() and ::slotted() select nothing', () => {
    assert.match(
      noNodesFoundError('sl-input::part(input)').suggestion,
      /select the part itself: \[part~="input"\]/
    );
    assert.match(noNodesFoundError('::slotted(span)').suggestion, /in the light DOM/);
  });
});
