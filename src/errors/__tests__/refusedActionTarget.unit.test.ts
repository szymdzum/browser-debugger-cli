/**
 * Refused actions (`--strict` click or hover, a fill whose text went to
 * another field) suggest a command naming the element as the user did: the
 * index of a listed element, otherwise the quoted selector (#603).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  pressNotReceivedError,
  textTypedElsewhereError,
  unreachableElementError,
} from '@/errors/messages.js';
import { BOUND_TARGET_SELECTOR } from '@/runtime/dom/targetNode.js';

const bound = { selector: BOUND_TARGET_SELECTOR, element: 'button "Shielded"', listIndex: 0 };
const bySelector = { selector: '#covered', element: 'button#covered "Covered"' };

void describe('refused action suggestions', () => {
  void it('name the index of a listed element, never the bound-node placeholder', () => {
    const suggestions = [
      unreachableElementError(bound, 'covered by another element (div#cover)', 'hover').suggestion,
      pressNotReceivedError(bound, 'click', 'div#inner-shield').suggestion,
      textTypedElsewhereError(bound, 'input#vis "Visible"').suggestion,
    ];
    assert.match(suggestions[0] ?? '', /bdg dom layout 0, then close/);
    assert.match(suggestions[1] ?? '', /bdg dom layout 0$/);
    assert.match(suggestions[2] ?? '', /bdg dom listeners 0$/);
    for (const suggestion of suggestions) {
      assert.ok(!suggestion.includes(BOUND_TARGET_SELECTOR), suggestion);
    }
  });

  void it('quote the selector when the index is not a non-negative integer', () => {
    for (const listIndex of ['0; echo pwned', -3, 1.5, Number.NaN, null, { a: 1 }]) {
      const target = { ...bySelector, listIndex: listIndex as unknown as number };
      assert.match(
        unreachableElementError(target, null, 'click').suggestion,
        /bdg dom layout '#covered', then close/,
        JSON.stringify(listIndex)
      );
      assert.match(
        pressNotReceivedError(target, 'click').suggestion,
        /bdg dom layout '#covered'$/,
        JSON.stringify(listIndex)
      );
      assert.match(
        textTypedElsewhereError(target, 'input#vis').suggestion,
        /bdg dom listeners '#covered'$/,
        JSON.stringify(listIndex)
      );
    }
  });

  void it('quote the selector of an element given by selector', () => {
    assert.match(
      unreachableElementError(bySelector, null, 'click').suggestion,
      /bdg dom layout '#covered', then close/
    );
    assert.match(
      pressNotReceivedError(bySelector, 'click').suggestion,
      /bdg dom layout '#covered'$/
    );
    assert.match(
      textTypedElsewhereError(bySelector, 'input#vis').suggestion,
      /bdg dom listeners '#covered'$/
    );
  });
});
