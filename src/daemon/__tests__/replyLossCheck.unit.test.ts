/**
 * The check that tells a reply Chrome could not send from a slow one (#712):
 * it is off for calls it cannot judge and for a page held at a breakpoint.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mayLoseReply, withReplyLossCheck } from '@/daemon/session/commandRegistry.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

type Call = Parameters<typeof mayLoseReply>[0];

const TIMING = { checkMs: 20, graceMs: 60 };

/**
 * A `Runtime.evaluate` call.
 *
 * @param params - Its parameters
 * @returns The call
 */
function evaluate(params: Record<string, unknown> = {}): Call {
  return { method: 'Runtime.evaluate', params: { expression: 'big()', ...params } };
}

/**
 * A connection that answers the check at once and lets the test fire events.
 *
 * @returns The connection and a way to fire `Debugger.paused`
 */
function fakeCdp(): {
  cdp: Parameters<typeof withReplyLossCheck>[0];
  pause: () => void;
} {
  const handlers: Array<() => void> = [];
  const cdp = {
    send: () => Promise.resolve({ result: { value: 1 } }),
    on: (_event: string, handler: () => void) => {
      handlers.push(handler);
      return () => undefined;
    },
  } as unknown as Parameters<typeof withReplyLossCheck>[0];
  return { cdp, pause: () => handlers.forEach((handler) => handler()) };
}

void describe('mayLoseReply', () => {
  void it('is true for a plain Runtime.evaluate', () => {
    assert.equal(mayLoseReply(evaluate()), true);
  });

  void it('is false for awaitPromise, a context id, or another method', () => {
    assert.equal(mayLoseReply(evaluate({ awaitPromise: true })), false);
    assert.equal(mayLoseReply(evaluate({ contextId: 3 })), false);
    assert.equal(mayLoseReply(evaluate({ uniqueContextId: 'abc' })), false);
    assert.equal(mayLoseReply({ method: 'DOM.getOuterHTML', params: {} }), false);
  });
});

void describe('mayLoseReply and await (#729)', () => {
  void it("is true for a script with 'await' only in a string or comment", () => {
    assert.equal(mayLoseReply(evaluate({ expression: "big() + 'await'" })), true);
    assert.equal(mayLoseReply(evaluate({ expression: 'big() // await' })), true);
  });

  void it('is false for a script with a top-level await', () => {
    assert.equal(mayLoseReply(evaluate({ expression: 'await big()' })), false);
  });
});

void describe('withReplyLossCheck', () => {
  void it('fails with exit 81 when the page answers the check but the reply never comes', async () => {
    const { cdp } = fakeCdp();
    await assert.rejects(
      withReplyLossCheck(cdp, evaluate(), new Promise<never>(() => undefined), TIMING),
      (error: unknown) =>
        error instanceof CommandError && error.exitCode === EXIT_CODES.INVALID_ARGUMENTS
    );
  });

  void it('returns the real reply when the page paused during the call', async () => {
    const { cdp, pause } = fakeCdp();
    const answer = new Promise<string>((resolve) => setTimeout(() => resolve('value'), 200));
    const result = withReplyLossCheck(cdp, evaluate(), answer, TIMING);
    pause();
    assert.equal(await result, 'value');
  });
});
