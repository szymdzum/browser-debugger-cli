/**
 * A page function called in the main world returns as soon as it answered:
 * the release of the global object it was called on is not waited for, as a
 * page that started a navigation (a form submit) holds every command until
 * the new document commits (#637).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { callFunctionInMainWorld } from '@/runtime/page/bdgWorld.js';

/**
 * A page whose `Runtime.releaseObject` never answers.
 *
 * @returns The connection and the methods it was sent
 */
function navigatingPage(): { cdp: CDPConnection; sent: string[] } {
  const sent: string[] = [];
  const cdp = {
    send: (method: string): Promise<unknown> => {
      sent.push(method);
      if (method === 'Runtime.evaluate') return Promise.resolve({ result: { objectId: 'global' } });
      if (method === 'Runtime.releaseObject') return new Promise(() => undefined);
      return Promise.resolve({ result: { value: 'submitted' } });
    },
  } as unknown as CDPConnection;
  return { cdp, sent };
}

void describe('callFunctionInMainWorld', () => {
  void it('returns the result without waiting for the global object to be released', async () => {
    const { cdp, sent } = navigatingPage();
    const response = await callFunctionInMainWorld(cdp, {
      functionDeclaration: 'function () { return "submitted"; }',
      returnByValue: true,
    });
    assert.equal(response.result.value, 'submitted');
    assert.deepEqual(sent, ['Runtime.evaluate', 'Runtime.callFunctionOn', 'Runtime.releaseObject']);
  });
});
