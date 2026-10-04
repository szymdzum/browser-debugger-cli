/**
 * The page-side copy of `dom eval` results keeps what JSON would lose.
 * It is run in a VM context, like the page would run it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import { JSON_SAFE_COPY_FUNCTION } from '@/runtime/dom/evalHelpers.js';

/**
 * Run the copy in a context, returned as JSON like CDP's `returnByValue`.
 *
 * @param expression - Expression creating the value
 * @param globals - Globals of the context
 * @returns The copy
 */
function copyOf(expression: string, globals: object = {}): unknown {
  const context = vm.createContext(globals);
  const json = vm.runInContext(
    `JSON.stringify((${JSON_SAFE_COPY_FUNCTION}).call(${expression}))`,
    context
  ) as string;
  return JSON.parse(json) as unknown;
}

void describe('JSON-safe copy of eval results', () => {
  void it('keeps values JSON would drop or change (undefined as null, like JSON in arrays)', () => {
    assert.deepEqual(copyOf('[1, undefined, NaN, -0, Infinity, 2n]'), [
      1,
      null,
      'NaN',
      '-0',
      'Infinity',
      '2n',
    ]);
  });

  void it('copies shared objects twice and marks only real cycles', () => {
    assert.deepEqual(copyOf('(o => ({ a: o, b: o }))({ x: 1 })'), { a: { x: 1 }, b: { x: 1 } });
    assert.deepEqual(copyOf('(o => (o.self = o, o))({ x: 1 })'), { x: 1, self: '[Circular]' });
  });

  void it('handles dates, maps and sets from another realm', () => {
    const foreignDate = vm.runInContext('new Date(0)', vm.createContext({})) as Date;
    assert.deepEqual(copyOf('({ d: foreignDate })', { foreignDate }), {
      d: '1970-01-01T00:00:00.000Z',
    });
    assert.deepEqual(copyOf('new Map([[1, new Set([2])]])'), [[1, [2]]]);
  });

  void it('survives throwing getters and cuts long lists', () => {
    assert.deepEqual(copyOf("({ ok: 1, get bad() { throw new Error('nope'); } })"), {
      ok: 1,
      bad: '[Error: nope]',
    });
    const long = copyOf('Array.from({ length: 1500 }, (_, i) => i)') as unknown[];
    assert.equal(long.length, 1001);
    assert.equal(long.at(-1), '…');
  });
});
