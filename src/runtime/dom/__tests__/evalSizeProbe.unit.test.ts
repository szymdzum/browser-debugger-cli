/**
 * `eval` results too large to send are refused within seconds, not after
 * the 20-30 s timeout (#705).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import vm from 'node:vm';

import { useFakeClock, type ClockHelper } from '@/__testutils__/testClock.js';
import type { CDPConnection } from '@/connection/cdp.js';
import { EVAL_FULL_MAX_BYTES } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { evaluateScript, sizeProbeFunction } from '@/runtime/dom/evalHelpers.js';
import { wrapEvalScript } from '@/runtime/dom/evalSource.js';

/**
 * A page whose answer to the script never arrives (Chrome could not send it)
 * while it answers everything else.
 *
 * @param script - The script that gets no answer
 * @returns Fake connection
 */
function pageThatCannotSend(script: string): CDPConnection {
  const never = new Promise<never>(() => undefined);
  return {
    on: () => () => undefined,
    isPagePaused: () => false,
    send: (method: string, params?: { expression?: string }) =>
      method === 'Runtime.evaluate' && params?.expression === wrapEvalScript(script)
        ? never
        : Promise.resolve({ result: { type: 'number', value: 1 } }),
  } as unknown as CDPConnection;
}

/**
 * A page whose script returns an object; copying it with a size cap as the
 * function's argument reports `tooLarge`, without one it returns the copy.
 *
 * @returns Fake connection
 */
function pageWithHugeObject(): CDPConnection {
  return {
    on: () => () => undefined,
    isPagePaused: () => false,
    send: (method: string, params?: { arguments?: unknown[] }) => {
      if (method === 'Runtime.evaluate' && params && !('arguments' in params)) {
        return Promise.resolve({
          result: { type: 'object', objectId: 'o1', description: 'Object' },
        });
      }
      if (method === 'Runtime.callFunctionOn' && params?.arguments) {
        return Promise.resolve({ result: { value: { tooLarge: 300e6 } } });
      }
      if (method === 'Runtime.callFunctionOn') {
        return Promise.resolve({ result: { value: { a: 'copied whole' } } });
      }
      return Promise.resolve({ result: { type: 'undefined' } });
    },
  } as unknown as CDPConnection;
}

void describe('evaluateScript with a result Chrome cannot send', () => {
  let clock: ClockHelper;

  beforeEach(() => {
    clock = useFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  void it('fails within 14 s when the page answers while the result is missing (102)', async () => {
    const script = "'x'.repeat(2 ** 29)";
    const outcome = evaluateScript(pageThatCannotSend(script), script).catch(
      (error: unknown) => error
    );
    await clock.tickAndFlush(1_000);
    await clock.tickAndFlush(12_000);
    await new Promise((resolve) => setImmediate(resolve));
    const error = await Promise.race([outcome, Promise.resolve('still waiting')]);
    assert.ok(error instanceof CommandError, `got ${String(error)}`);
    assert.equal(error.exitCode, 102);
    assert.match(error.message, /too large to send/i);
  });

  void it('refuses the same result with --full as over the cap (81)', async () => {
    const script = "'x'.repeat(2 ** 29)";
    const outcome = evaluateScript(pageThatCannotSend(script), script, { full: true }).catch(
      (error: unknown) => error
    );
    await clock.tickAndFlush(1_000);
    await clock.tickAndFlush(12_000);
    await new Promise((resolve) => setImmediate(resolve));
    const error = await Promise.race([outcome, Promise.resolve('still waiting')]);
    assert.ok(error instanceof CommandError, `got ${String(error)}`);
    assert.equal(error.exitCode, 81);
    assert.match(error.message, /50 MiB/);
  });

  void it('refuses an object over the transfer limit without --full (81)', async () => {
    const error = await evaluateScript(pageWithHugeObject(), '({a: 1})').catch(
      (caught: unknown) => caught
    );
    assert.ok(error instanceof CommandError, `got ${JSON.stringify(error)}`);
    assert.equal(error.exitCode, 81);
    assert.match(error.message, /too large/i);
  });
});

void describe('evaluateScript with a script that finishes after the check', () => {
  let clock: ClockHelper;

  beforeEach(() => {
    clock = useFakeClock();
  });

  afterEach(() => {
    clock.restore();
  });

  void it('returns the result when it arrives after the page answered the check', async () => {
    const script = '"done"';
    let answer: (value: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => {
      answer = resolve;
    });
    const page = {
      on: () => () => undefined,
      isPagePaused: () => false,
      send: (method: string, params?: { expression?: string }) =>
        method === 'Runtime.evaluate' && params?.expression === wrapEvalScript(script)
          ? slow
          : Promise.resolve({ result: { type: 'number', value: 1 } }),
    } as unknown as CDPConnection;
    const outcome = evaluateScript(page, script).catch((error: unknown) => error);
    await clock.tickAndFlush(1_000);
    await clock.tickAndFlush(3_000);
    answer({ result: { type: 'string', value: 'done' } });
    await new Promise((resolve) => setImmediate(resolve));
    await clock.tickAndFlush(12_000);
    await new Promise((resolve) => setImmediate(resolve));
    const result = await Promise.race([outcome, Promise.resolve('still waiting')]);
    assert.deepEqual(result, { value: 'done', type: 'string' });
  });
});

void describe('sizeProbeFunction', () => {
  /**
   * Run the probe in a context whose Object.keys the page replaced.
   *
   * @param expression - Builds the probed value
   * @param cap - The cap
   * @returns What the probe returned
   */
  function probe(expression: string, cap: number): { tooLarge?: number } {
    const context = vm.createContext({});
    vm.runInContext(
      'Object.keys = () => ["a"]; Object.prototype.hasOwnProperty = () => false;',
      context
    );
    const value: unknown = vm.runInContext(expression, context);
    const fn = vm.runInContext(`(${sizeProbeFunction()})`, context) as (
      this: unknown,
      cap: number
    ) => { tooLarge?: number };
    return fn.call(value, cap);
  }

  void it('stops at the cap on a page that replaced built-ins', () => {
    const answer = probe(`({ a: 'x'.repeat(${EVAL_FULL_MAX_BYTES} + 1) })`, EVAL_FULL_MAX_BYTES);
    assert.ok((answer.tooLarge ?? 0) > EVAL_FULL_MAX_BYTES);
  });

  void it('lets a small object and a cycle through', () => {
    assert.equal(probe(`({ a: [1, 'two', { b: 3 }] })`, EVAL_FULL_MAX_BYTES).tooLarge, undefined);
    assert.equal(
      probe(`(() => { const o = {}; o.self = o; return o; })()`, 1000).tooLarge,
      undefined
    );
  });
});
