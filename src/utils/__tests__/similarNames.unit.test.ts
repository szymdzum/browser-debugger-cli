/**
 * "Did you mean" for a selector that is a single id or class: near-typos,
 * then names sharing their end, then names sharing their start.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findSimilarNames, parseSingleNameSelector } from '@/utils/suggestions.js';

/** Ids of saucedemo's inventory page with the backpack in the cart */
const INVENTORY_IDS = [
  'add-to-cart-sauce-labs-bike-light',
  'add-to-cart-sauce-labs-bolt-t-shirt',
  'add-to-cart-sauce-labs-fleece-jacket',
  'add-to-cart-sauce-labs-onesie',
  'remove-sauce-labs-backpack',
  'item_4_title_link',
  'react-burger-menu-btn',
  'shopping_cart_container',
];

void describe('findSimilarNames', () => {
  void it('suggests the id an item got after its state changed first', () => {
    const similar = findSimilarNames('add-to-cart-sauce-labs-backpack', INVENTORY_IDS);
    assert.equal(similar[0], 'remove-sauce-labs-backpack');
    assert.equal(similar.length, 3);
    assert.ok(similar.slice(1).every((id) => id.startsWith('add-to-cart-sauce-labs-')));
  });

  void it('puts near-typos first and leaves the name itself out', () => {
    assert.deepEqual(findSimilarNames('btn-primray', ['btn-primary', 'btn-primray', 'btn']), [
      'btn-primary',
    ]);
  });

  void it('suggests nothing for unrelated names', () => {
    assert.deepEqual(findSimilarNames('checkout', INVENTORY_IDS), []);
  });
});

void describe('parseSingleNameSelector', () => {
  void it('reads a single id or class', () => {
    assert.deepEqual(parseSingleNameSelector('#add-to-cart'), { kind: 'id', name: 'add-to-cart' });
    assert.deepEqual(parseSingleNameSelector(' .btn_primary '), {
      kind: 'class',
      name: 'btn_primary',
    });
  });

  void it('ignores any other selector', () => {
    for (const selector of ['button#save', '#a .b', '.a.b', '#1x', '[id=x]', 'div']) {
      assert.equal(parseSingleNameSelector(selector), null, selector);
    }
  });
});
