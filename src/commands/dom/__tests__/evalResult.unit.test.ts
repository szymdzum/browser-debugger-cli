/**
 * How `dom eval --json` bounds its result (#478): long strings, long arrays
 * and structured values whose JSON is over the cap.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boundEvalResult } from '@/commands/dom/helpers/evalResult.js';
import { EVAL_JSON_ARRAY_LIMIT, MAX_VALUE_LENGTH } from '@/constants.js';

void describe('boundEvalResult', () => {
  void it('keeps the first 100 elements of a long array, with count and omitted', () => {
    const value = Array.from({ length: 300 }, (_, index) => index);
    const bounded = boundEvalResult(value);
    assert.deepEqual(bounded.result, value.slice(0, EVAL_JSON_ARRAY_LIMIT));
    assert.equal(bounded.count, 300);
    assert.equal(bounded.omitted, 200);
    assert.equal(bounded.truncatedFrom, undefined);
  });

  void it('counts the elements of the array in the page when its copy holds fewer', () => {
    const copy = [...Array.from({ length: 1000 }, (_, index) => index), '…'];
    const bounded = boundEvalResult(copy, 20_000);
    assert.equal((bounded.result as unknown[]).length, EVAL_JSON_ARRAY_LIMIT);
    assert.equal(bounded.count, 20_000);
    assert.equal(bounded.omitted, 19_900);
  });

  void it('returns an array still over the cap as the start of its JSON text', () => {
    const value = Array.from(
      { length: 300 },
      (_, index) => `<div id="d${index}">${'x'.repeat(500)}</div>`
    );
    const json = JSON.stringify(value);
    const bounded = boundEvalResult(value);
    assert.equal(bounded.result, json.slice(0, MAX_VALUE_LENGTH));
    assert.equal(bounded.truncatedFrom, json.length);
    assert.equal(bounded.count, 300);
    assert.equal(bounded.omitted, undefined);
  });

  void it('returns an object over the cap as the start of its JSON text', () => {
    const value = {
      a: { b: { c: Array.from({ length: 50 }, () => ({ text: 'y'.repeat(1000) })) } },
    };
    const json = JSON.stringify(value);
    const bounded = boundEvalResult(value);
    assert.equal(bounded.result, json.slice(0, MAX_VALUE_LENGTH));
    assert.equal(bounded.truncatedFrom, json.length);
    assert.equal(bounded.count, undefined);
  });

  void it('cuts a long string result', () => {
    const bounded = boundEvalResult('s'.repeat(MAX_VALUE_LENGTH + 5));
    assert.equal(bounded.result, 's'.repeat(MAX_VALUE_LENGTH));
    assert.equal(bounded.truncatedFrom, MAX_VALUE_LENGTH + 5);
  });

  void it('leaves small values untouched', () => {
    for (const value of [42, null, true, 'text', [1, 2, 3], { a: [1, { b: 'c' }] }, undefined]) {
      assert.deepEqual(boundEvalResult(value), { result: value });
    }
    const hundred = Array.from({ length: EVAL_JSON_ARRAY_LIMIT }, (_, index) => index);
    assert.deepEqual(boundEvalResult(hundred), { result: hundred });
  });
});
