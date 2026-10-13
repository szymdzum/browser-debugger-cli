/**
 * An eval the daemon has already answered is not stopped when its client
 * disconnects (#713 regression): Chrome could not send its result, so its
 * call stays pending, and the page may by then run another client's script.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { evaluateScript } from '@/runtime/dom/evalHelpers.js';

/** How long the page gets to receive a stop after the client disconnected */
const STOP_WINDOW_MS = 1_500;

/**
 * A page that never sends the eval's result and, once `busy`, answers
 * nothing else either (another client's script runs).
 */
class LostResultPage {
  readonly sent: string[] = [];
  busy = false;

  /**
   * Answer a CDP command.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns The answer
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.sent.push(method);
    if (method === 'Runtime.evaluate' && params['expression'] === 'lost') {
      return new Promise(() => undefined);
    }
    if (method === 'Runtime.evaluate' && !this.busy) {
      return Promise.resolve({ result: { type: 'number', value: 1 } });
    }
    if (method === 'Runtime.evaluate') return new Promise(() => undefined);
    return Promise.resolve({});
  }
}

void describe('evaluateScript after its answer', () => {
  void it('sends no terminateExecution when the client disconnects after a lost result', async () => {
    const page = new LostResultPage();
    const client = new AbortController();
    await assert.rejects(
      evaluateScript(page as unknown as CDPConnection, 'lost', { abandoned: client.signal }),
      /could not send its result/i
    );
    page.busy = true;
    client.abort();
    await new Promise((resolve) => setTimeout(resolve, STOP_WINDOW_MS));
    assert.ok(!page.sent.includes('Runtime.terminateExecution'), page.sent.join(', '));
  });
});
