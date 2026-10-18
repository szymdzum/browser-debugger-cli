/**
 * What logpoints ask of Chrome around their life (#848): the first logpoint
 * turns `Debugger` on, ending the session or the last clear gives Chrome back
 * as it was (also a user's own Chrome), a failed start is rolled back, and a
 * tab the session leaves is released while the logpoints stay.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { Logpoints } from '@/daemon/session/logpoints.js';

/** A connection that records its calls and fails the methods named */
function fakeCdp(failing: Set<string> = new Set()): CDPConnection & {
  calls: Array<[string, unknown]>;
} {
  const calls: Array<[string, unknown]> = [];
  const cdp = {
    calls,
    on: () => () => undefined,
    send: (method: string, params: unknown) => {
      calls.push([method, params]);
      if (failing.has(method)) return Promise.reject(new Error(`${method} refused`));
      if (method === 'Debugger.setBreakpointByUrl') {
        return Promise.resolve({ breakpointId: 'b1', locations: [] });
      }
      return Promise.resolve({});
    },
  };
  return cdp as unknown as CDPConnection & { calls: Array<[string, unknown]> };
}

const PARAMS = { file: 'app.js', line: 3, expressions: ['x'] };

/** Methods called, in order */
function methods(cdp: { calls: Array<[string, unknown]> }): string[] {
  return cdp.calls.map(([method]) => method);
}

void describe('logpoints and Chrome', () => {
  void it('ending the session takes back the binding, the pause setting and Debugger', async () => {
    const logpoints = new Logpoints(() => 0);
    const cdp = fakeCdp();
    await logpoints.add(cdp, PARAMS);
    cdp.calls.length = 0;
    await logpoints.shutdown(cdp);
    assert.deepEqual(methods(cdp), [
      'Runtime.removeBinding',
      'Debugger.setSkipAllPauses',
      'Debugger.disable',
    ]);
    assert.deepEqual(cdp.calls[1]?.[1], { skip: false });
    assert.equal(logpoints.size, 0);
  });

  void it('ending a session that never set a logpoint sends nothing', async () => {
    const cdp = fakeCdp();
    await new Logpoints(() => 0).shutdown(cdp);
    assert.deepEqual(cdp.calls, []);
  });

  void it('a failed start is rolled back and the next one starts again', async () => {
    const logpoints = new Logpoints(() => 0);
    const cdp = fakeCdp(new Set(['Runtime.addBinding']));
    await assert.rejects(logpoints.add(cdp, PARAMS), /addBinding refused/);
    assert.ok(methods(cdp).includes('Debugger.disable'), methods(cdp).join());
    assert.equal(logpoints.size, 0);
    const retry = fakeCdp();
    await logpoints.add(retry, PARAMS);
    assert.ok(methods(retry).includes('Debugger.enable'), methods(retry).join());
    assert.equal(logpoints.size, 1);
  });

  void it('leaving a tab releases it and keeps the logpoints', async () => {
    const logpoints = new Logpoints(() => 0);
    const cdp = fakeCdp();
    await logpoints.add(cdp, PARAMS);
    cdp.calls.length = 0;
    await logpoints.leave(cdp);
    assert.ok(methods(cdp).includes('Debugger.disable'));
    assert.equal(logpoints.size, 1);
  });
});
