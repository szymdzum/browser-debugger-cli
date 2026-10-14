/**
 * `await` detection of `bdg dom eval` scripts (#729): V8 tells a top-level
 * `await` from the word in a string, comment, regex or nested function.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasTopLevelAwait } from '@/runtime/dom/topLevelAwait.js';

/** Script, whether it awaits at its top level, and why */
const CASES: Array<[string, boolean, string]> = [
  ['1 + 1', false, 'plain expression'],
  ["while (Date.now() < end) {}; 'await'", false, 'single-quoted string'],
  ['`await ${x}`', false, 'template literal'],
  ['x // await later', false, 'line comment'],
  ['/* await */ x', false, 'block comment'],
  ['awaitX + 1', false, 'identifier containing await'],
  ['/await/.test(s)', false, 'regex literal'],
  ['(async () => { await p; })()', false, 'async IIFE not awaited'],
  ['function f() { return "await"; } f()', false, 'nested sync function with a string'],
  ['await p', true, 'top-level await'],
  ['x = 1; await sleep(10); x', true, 'await after statements'],
  ['await (async () => { await p; })()', true, 'awaited async IIFE'],
  ['for await (const x of xs) {}', true, 'for await'],
  ['{ await p }', true, 'await inside a block'],
  ['1 +', false, 'syntax error without await'],
  ["'await' +", true, 'syntax error: falls back to a text search'],
];

void describe('hasTopLevelAwait', () => {
  for (const [script, expected, label] of CASES) {
    void it(`${label}: ${expected ? 'awaits' : 'sync'}`, () => {
      assert.equal(hasTopLevelAwait(script), expected, script);
    });
  }
});

void describe('hasTopLevelAwait on a huge script', () => {
  void it('falls back to the text search instead of compiling megabytes', () => {
    const script = `'await' + '${'x'.repeat(2_000_000)}'`;
    const startedAt = performance.now();
    assert.equal(hasTopLevelAwait(script), true);
    assert.ok(performance.now() - startedAt < 50, 'compiled the huge script');
  });
});
