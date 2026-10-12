/**
 * `dom eval` whose result Chrome cannot send (about 256 MiB and more, Chrome
 * never answers): the error names the result, not a promise (#687).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { useFakeClock, type ClockHelper } from '@/__testutils__/testClock.js';
import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { evaluateScript } from '@/runtime/dom/evalHelpers.js';

/**
 * A page that never answers the script's evaluation (the result is too large
 * to send) and answers everything else.
 *
 * @param script - The script that gets no answer
 * @returns Fake connection
 */
function pageThatCannotSend(script: string): CDPConnection {
  const never = new Promise<never>(() => undefined);
  return {
    send: (method: string, params?: { expression?: string }) =>
      method === 'Runtime.evaluate' && params?.expression === script
        ? never
        : Promise.resolve({ result: { type: 'number', value: 1 } }),
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

  void it('names the result and does not claim a promise (102)', async () => {
    const script = "'x'.repeat(2 ** 28)";
    const outcome = evaluateScript(pageThatCannotSend(script), script).catch(
      (error: unknown) => error
    );
    await clock.tickAndFlush(30_000);
    const error = await outcome;
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, 102);
    assert.doesNotMatch(error.message, /promise/i);
    assert.match(`${error.message} ${String(error.metadata['suggestion'])}`, /too large to send/i);
  });

  void it('keeps the promise message for a script that awaits, naming the large result as a second cause', async () => {
    const script = 'await new Promise(() => {})';
    const outcome = evaluateScript(pageThatCannotSend(script), script).catch(
      (error: unknown) => error
    );
    await clock.tickAndFlush(30_000);
    const error = await outcome;
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, 102);
    assert.match(error.message, /The awaited promise did not settle within 20s/);
    assert.match(String(error.metadata['suggestion']), /too large to send/);
  });
});
