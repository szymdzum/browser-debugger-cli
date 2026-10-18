/**
 * What logpoints ask of Chrome around their life (#848): the first logpoint
 * turns `Debugger` on, ending the session or the last clear gives Chrome back
 * as it was (also a user's own Chrome), a failed start is rolled back, and a
 * tab the session leaves is released while the logpoints stay.
 */

import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
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

  void it('Chrome refusing a second breakpoint at a place is 84, and nothing is kept', async () => {
    const logpoints = new Logpoints(() => 0);
    const cdp = fakeCdp();
    const send = cdp.send.bind(cdp);
    (cdp as { send: unknown }).send = (method: string, params?: Record<string, unknown>) =>
      method === 'Debugger.setBreakpointByUrl'
        ? Promise.reject(new Error('Breakpoint at specified location already exists.'))
        : send(method, params);
    await assert.rejects(
      logpoints.add(cdp, PARAMS),
      (error: unknown) => (error as { exitCode?: number }).exitCode === 84
    );
    assert.equal(logpoints.size, 0);
  });

  void it('a column of 1 is the same place as no column', async () => {
    const logpoints = new Logpoints(() => 0);
    const cdp = fakeCdp();
    await logpoints.add(cdp, PARAMS);
    await assert.rejects(
      logpoints.add(cdp, { ...PARAMS, column: 1 }),
      (error: unknown) => (error as { exitCode?: number }).exitCode === 84
    );
    assert.equal(logpoints.size, 1);
  });

  void it('maps are fetched only for logpoints that wait for a file, not for ones bound by URL', async () => {
    let fetched = 0;
    const server = http.createServer((_req, res) => {
      fetched++;
      res.end('{"version":3,"sources":[],"mappings":""}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const handlers = new Map<string, (event: unknown) => void>();
      const cdp = fakeCdp();
      (cdp as { on: unknown }).on = (method: string, handler: (event: unknown) => void) => {
        handlers.set(method, handler);
        return () => undefined;
      };
      const send = cdp.send.bind(cdp);
      (cdp as { send: unknown }).send = (method: string, params?: Record<string, unknown>) =>
        method === 'Debugger.setBreakpointByUrl' && String(params?.['urlRegex']).includes('app')
          ? Promise.resolve({
              breakpointId: 'b-app',
              locations: [{ scriptId: '1', lineNumber: 2, columnNumber: 0 }],
            })
          : send(method, params);
      const logpoints = new Logpoints(() => 0);
      logpoints.follow(cdp);
      const parsed = (scriptId: string, url: string, hash: string, sourceMapURL?: string): void =>
        handlers.get('Debugger.scriptParsed')?.({
          scriptId,
          url,
          endLine: 10,
          endColumn: 0,
          hash,
          ...(sourceMapURL && { sourceMapURL }),
        });
      parsed('1', 'http://h/app.js', 'a');
      await logpoints.add(cdp, PARAMS);
      parsed('2', `${origin}/one.js`, 'b', `${origin}/one.js.map`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(fetched, 0, 'bound by URL: no map is fetched');
      await logpoints.add(cdp, { ...PARAMS, file: 'lazy.js', line: 2 });
      parsed('3', `${origin}/two.js`, 'c', `${origin}/two.js.map`);
      for (let waited = 0; fetched === 0 && waited < 50; waited++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(fetched, 1, 'a waiting logpoint reads the map');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
