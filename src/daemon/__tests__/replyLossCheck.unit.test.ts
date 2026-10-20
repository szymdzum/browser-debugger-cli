/**
 * The check that tells a reply Chrome could not send from a slow one (#712):
 * it is off for calls it cannot judge and for a page held at a breakpoint.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { mayLoseReply, withReplyLossCheck } from '@/daemon/session/commandRegistry.js';
import { CommandError } from '@/errors/index.js';
import { evaluateScript } from '@/runtime/dom/evalHelpers.js';
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

/**
 * A page connection for `evaluateScript`: the script never answers, the
 * trivial check does, and the test pauses the debugger like Chrome does.
 *
 * @param pausedAtStart - Whether the page is paused before the call
 * @returns The connection and a way to pause it
 */
function pageCdp(pausedAtStart: boolean): { cdp: CDPConnection; pause: () => void } {
  let paused = pausedAtStart;
  const handlers: Array<() => void> = [];
  const cdp = {
    send: (method: string, params?: { expression?: string }) =>
      method === 'Runtime.evaluate' && params?.expression !== '1'
        ? new Promise<never>(() => undefined)
        : Promise.resolve({ result: { value: 1 } }),
    on: (event: string, handler: () => void) => {
      if (event === 'Debugger.paused') handlers.push(handler);
      return () => undefined;
    },
    isPagePaused: () => paused,
  } as unknown as CDPConnection;
  return {
    cdp,
    pause: () => {
      paused = true;
      handlers.forEach((handler) => handler());
    },
  };
}

/**
 * What `evaluateScript` ends with within two seconds.
 *
 * @param evaluation - The call
 * @returns Its error, or a note that it was still waiting
 */
async function outcomeWithin2s(evaluation: Promise<unknown>): Promise<unknown> {
  const waiting = new Promise<string>((resolve) =>
    setTimeout(() => resolve('still waiting'), 2000)
  );
  return Promise.race([
    evaluation.then(
      () => 'resolved',
      (error: unknown) => error
    ),
    waiting,
  ]);
}

void describe('evaluateScript on a paused page (#857)', () => {
  void it('fails with exit 85 naming the pause when the page pauses during the call', async () => {
    const { cdp, pause } = pageCdp(false);
    const evaluation = evaluateScript(cdp, '1+1');
    setTimeout(pause, 20);
    const error = await outcomeWithin2s(evaluation);
    assert.ok(error instanceof CommandError, String(error));
    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_BUSY);
    assert.match(error.message, /paused in the debugger/i);
    assert.match(error.metadata.suggestion ?? '', /Debugger\.resume/);
  });

  void it('fails with exit 85 at once when the page was paused before the call', async () => {
    const { cdp } = pageCdp(true);
    const error = await outcomeWithin2s(evaluateScript(cdp, '1+1'));
    assert.ok(error instanceof CommandError, String(error));
    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_BUSY);
    assert.match(error.message, /paused in the debugger/i);
  });
});
