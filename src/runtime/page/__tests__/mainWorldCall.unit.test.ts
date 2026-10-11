/**
 * A page function called in the main world: it is called on the page's
 * global object looked up as `this` (a page can set `globalThis` to
 * anything), on the document when the page hands out no global object, it
 * returns without waiting for the object's release (a page that started a
 * navigation holds every command until the new document commits), and a
 * page that navigated between the lookup and the call fails it as a lost
 * context (#637).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import { isContextLostError } from '@/runtime/dom/evalHelpers.js';
import { callFunctionInMainWorld } from '@/runtime/page/bdgWorld.js';

/** One CDP call as the page saw it */
interface Call {
  method: string;
  params: Record<string, unknown>;
}

/**
 * A page whose `Runtime.releaseObject` never answers.
 *
 * @param options - `noGlobal`: the global lookup yields no object;
 *   `callError`: what the call fails with
 * @returns The connection and the calls it got
 */
function page(options: { noGlobal?: boolean; callError?: string } = {}): {
  cdp: CDPConnection;
  calls: Call[];
} {
  const calls: Call[] = [];
  const answer = (method: string): Promise<unknown> => {
    switch (method) {
      case 'Runtime.evaluate':
        return Promise.resolve(
          options.noGlobal ? { result: { type: 'undefined' } } : { result: { objectId: 'global' } }
        );
      case 'DOM.getDocument':
        return Promise.resolve({ root: { nodeId: 1 } });
      case 'DOM.resolveNode':
        return Promise.resolve({ object: { objectId: 'document' } });
      case 'Runtime.releaseObject':
        return new Promise(() => undefined);
      case 'Runtime.callFunctionOn':
        return options.callError
          ? Promise.reject(new CDPProtocolError(options.callError, -32000, undefined))
          : Promise.resolve({ result: { value: 'submitted' } });
      default:
        return Promise.resolve({});
    }
  };
  const cdp = {
    send: (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      calls.push({ method, params });
      return answer(method);
    },
  } as unknown as CDPConnection;
  return { cdp, calls };
}

const CALL = { functionDeclaration: 'function () { return "submitted"; }', returnByValue: true };

void describe('callFunctionInMainWorld', () => {
  void it('calls on the global object looked up as this, without waiting for its release', async () => {
    const { cdp, calls } = page();
    const response = await callFunctionInMainWorld(cdp, CALL);
    assert.equal(response.result.value, 'submitted');
    assert.deepEqual(
      calls.map((call) => call.method),
      ['Runtime.evaluate', 'Runtime.callFunctionOn', 'Runtime.releaseObject']
    );
    assert.equal(calls[0]?.params['expression'], 'this');
    assert.equal(calls[1]?.params['objectId'], 'global');
  });

  void it('calls on the document when the page hands out no global object', async () => {
    const { cdp, calls } = page({ noGlobal: true });
    const response = await callFunctionInMainWorld(cdp, CALL);
    assert.equal(response.result.value, 'submitted');
    const call = calls.find(({ method }) => method === 'Runtime.callFunctionOn');
    assert.equal(call?.params['objectId'], 'document');
  });

  void it('fails as a lost context when the page navigated between the lookup and the call', async () => {
    const { cdp } = page({ callError: 'Could not find object with given id' });
    await assert.rejects(callFunctionInMainWorld(cdp, CALL), (error: unknown) =>
      isContextLostError(error)
    );
  });
});
