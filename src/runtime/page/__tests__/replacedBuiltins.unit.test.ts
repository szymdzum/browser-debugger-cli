/**
 * Which built-ins a page replaced: checks that run at the same time (an
 * interaction and a `dom eval`, or two evals) do not free each other's page
 * objects, which would report nothing replaced (#584).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FakeObjectPage } from '@/__testutils__/fakeObjectPage.js';
import { findReplacedBuiltins } from '@/runtime/page/replacedBuiltins.js';

/** The collected `index, function` list: the first name's function is not native */
const REPLACED_FIRST = {
  result: [
    { name: '0', configurable: true, enumerable: true, value: { type: 'number', value: 0 } },
    {
      name: '1',
      configurable: true,
      enumerable: true,
      value: { type: 'function', description: 'function () { return []; }' },
    },
  ],
};

void describe('findReplacedBuiltins', () => {
  void it('reports the replaced built-ins of concurrent checks when one releases its objects first (#584)', async () => {
    const page = new FakeObjectPage({
      lookupsFirst: 2,
      hold: (method, params) =>
        method === 'Runtime.evaluate' && String(params['expression']).includes('alert'),
      properties: () => REPLACED_FIRST,
    });
    const checks = await Promise.all([
      findReplacedBuiltins(page, ['window.fetch']),
      findReplacedBuiltins(page, ['window.alert']),
    ]);
    assert.deepEqual(checks, [['window.fetch'], ['window.alert']]);
    assert.deepEqual(page.releasedUses, []);
  });
});
