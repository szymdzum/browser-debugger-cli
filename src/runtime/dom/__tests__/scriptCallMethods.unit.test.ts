/**
 * The raw `bdg cdp` methods whose page script is stopped when their client
 * disconnects (#726): the two that run a script; other methods (a
 * navigation, a Network call) are left as they are.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stopsScriptWhenAbandoned } from '@/runtime/dom/evalHelpers.js';

void describe('stopsScriptWhenAbandoned', () => {
  for (const method of ['Runtime.evaluate', 'Runtime.callFunctionOn']) {
    void it(`stops ${method}`, () => {
      assert.equal(stopsScriptWhenAbandoned(method), true);
    });
  }

  for (const method of [
    'Page.navigate',
    'Network.getResponseBody',
    'Runtime.awaitPromise',
    'Debugger.evaluateOnCallFrame',
    'Runtime.terminateExecution',
  ]) {
    void it(`leaves ${method} alone`, () => {
      assert.equal(stopsScriptWhenAbandoned(method), false);
    });
  }
});
