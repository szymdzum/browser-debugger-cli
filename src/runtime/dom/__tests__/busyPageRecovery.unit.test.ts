/**
 * A page busy with its own scripts is recovered; a slow but live page is waited for.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import { CommandError } from '@/errors/index.js';
import {
  evaluateScript,
  isContextLostError,
  withBusyPageRecovery,
} from '@/runtime/dom/evalHelpers.js';

const LIMITS = { busyAfterMs: 30, livenessMs: 30 };

/**
 * CDP stub whose liveness check answers or not, recording terminations.
 *
 * @param pageAnswers - Whether `Runtime.evaluate` answers
 * @returns Stub and the methods it received
 */
function fakeCdp(pageAnswers: boolean): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const cdp = {
    send: (method: string) => {
      sent.push(method);
      if (method === 'Runtime.evaluate' && !pageAnswers) return new Promise(() => undefined);
      return Promise.resolve({});
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

/**
 * A command that answers after `ms`.
 *
 * @param ms - Delay
 * @returns The command
 */
function answersAfter(ms: number): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve('done'), ms));
}

void describe('withBusyPageRecovery', () => {
  void it('returns a fast command without checking the page', async () => {
    const { cdp, sent } = fakeCdp(false);
    assert.equal(await withBusyPageRecovery(cdp, answersAfter(5), LIMITS), 'done');
    assert.deepEqual(sent, []);
  });

  void it('keeps waiting for a slow command while the page answers', async () => {
    const { cdp, sent } = fakeCdp(true);
    assert.equal(await withBusyPageRecovery(cdp, answersAfter(120), LIMITS), 'done');
    assert.ok(!sent.includes('Runtime.terminateExecution'));
  });

  void it('terminates the page scripts and fails with 102 when the page is busy', async () => {
    const { cdp, sent } = fakeCdp(false);
    await assert.rejects(
      withBusyPageRecovery(cdp, new Promise(() => undefined), LIMITS),
      (error) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.exitCode, 102);
        return true;
      }
    );
    assert.ok(sent.includes('Runtime.terminateExecution'));
  });

  void it('names an iframe, not the page, when a frame was busy', async () => {
    const { cdp } = fakeCdp(false);
    await assert.rejects(
      withBusyPageRecovery(cdp, new Promise(() => undefined), { ...LIMITS, scope: 'frame' }),
      /^CommandError: The frame was busy/
    );
  });
});

void describe('lost execution contexts', () => {
  void it("recognises Chrome's errors for a navigated or removed document", () => {
    for (const message of [
      'Execution context was destroyed.',
      'Inspected target navigated or closed',
      'Cannot find context with specified id',
      'uniqueContextId not found',
      'Session with given id not found.',
    ]) {
      assert.ok(isContextLostError(new CDPProtocolError(message, -32000, undefined)), message);
    }
    assert.ok(!isContextLostError(new CDPProtocolError('Invalid parameters', -32602, undefined)));
    assert.ok(!isContextLostError(new Error('Execution context was destroyed.')));
  });

  void it('reports a page that navigated during an eval as 83, not a connection failure', async () => {
    const cdp = {
      send: (method: string) =>
        method === 'Runtime.evaluate'
          ? Promise.reject(
              new CDPProtocolError('Inspected target navigated or closed', -32000, undefined)
            )
          : Promise.resolve({}),
    } as unknown as CDPConnection;
    await assert.rejects(evaluateScript(cdp, 'location.href = "/next"; await sleep()'), (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, 83);
      assert.match(error.message, /page navigated while the script ran/);
      return true;
    });
  });
});
