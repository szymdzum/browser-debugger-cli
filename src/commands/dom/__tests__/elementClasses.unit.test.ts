/**
 * The class list `dom query`, `dom get` and `dom get --raw` report: always
 * an array, empty for an element without classes (#573).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { elementClasses } from '@/commands/dom/helpers/elementClasses.js';

void describe('elementClasses', () => {
  void it('is empty for an element without a class attribute', () => {
    assert.deepEqual(elementClasses({ id: 'pin', name: 'pin' }), []);
  });

  void it('is empty for an empty or blank class attribute', () => {
    assert.deepEqual(elementClasses({ class: '' }), []);
    assert.deepEqual(elementClasses({ class: ' \t\n ' }), []);
  });

  void it('lists the classes in attribute order, whitespace collapsed', () => {
    assert.deepEqual(elementClasses({ class: '  primary\tlarge \n ' }), ['primary', 'large']);
  });
});
