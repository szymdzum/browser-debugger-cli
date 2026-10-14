/**
 * An eval whose client disconnected has its script stopped (#713), also
 * when the client was gone before the evaluation was sent.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { evaluateScript } from '@/runtime/dom/evalHelpers.js';
import { wrapEvalScript } from '@/runtime/dom/evalSource.js';

/**
 * A page whose script runs until `Runtime.terminateExecution` arrives and
 * which answers nothing else while it runs.
 */
class BusyPage {
  readonly sent: string[] = [];
  private stopScript: (() => void) | undefined;

  /**
   * Answer a CDP command.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns The answer
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.sent.push(method);
    if (method === 'Runtime.evaluate' && params['expression'] === wrapEvalScript('loop')) {
      return new Promise((resolve) => {
        this.stopScript = () =>
          resolve({
            result: { type: 'object', subtype: 'error' },
            exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: terminated' } },
          });
      });
    }
    if (method === 'Runtime.evaluate') return new Promise(() => undefined);
    if (method === 'Runtime.terminateExecution') this.stopScript?.();
    return Promise.resolve({});
  }
}

void describe('evaluateScript with an abandoned client', () => {
  void it('stops the script when the client was gone before the evaluation was sent', async () => {
    const page = new BusyPage();
    const gone = new AbortController();
    gone.abort();
    const startedAt = Date.now();
    const evaluation = evaluateScript(page as unknown as CDPConnection, 'loop', {
      abandoned: gone.signal,
    });
    await assert.rejects(evaluation);
    assert.ok(page.sent.includes('Runtime.terminateExecution'), page.sent.join(', '));
    assert.ok(Date.now() - startedAt < 5_000, `settled after ${Date.now() - startedAt} ms`);
  });
});
