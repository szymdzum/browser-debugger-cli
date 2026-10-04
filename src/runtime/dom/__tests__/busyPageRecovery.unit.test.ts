/**
 * A page busy with its own scripts is recovered; a slow but live page is waited for.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { withBusyPageRecovery } from '@/runtime/dom/evalHelpers.js';

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
});
