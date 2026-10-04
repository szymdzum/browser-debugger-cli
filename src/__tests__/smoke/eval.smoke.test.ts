/**
 * `bdg dom eval` smoke test.
 *
 * Values JSON cannot represent must come back as readable descriptions with
 * their type (not `undefined` or `{}`), script exceptions are user errors
 * (exit 91), and an endless loop is terminated so the page stays usable.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

interface EvalData {
  result?: unknown;
  type: string;
  subtype?: string;
}

/**
 * Evaluate an expression and return the envelope data and exit code.
 *
 * @param expression - JavaScript expression
 * @param timeout - Command timeout in ms
 * @returns Exit code and parsed output
 */
async function evaluate(
  expression: string,
  timeout = 60000
): Promise<{ exitCode: number; data?: EvalData; error?: string }> {
  const result = await runCommand('dom', ['eval', expression, '--json'], { timeout });
  const envelope = JSON.parse(result.stdout) as { data?: EvalData; error?: string };
  return { exitCode: result.exitCode, ...envelope };
}

void describe('dom eval', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('returns values JSON cannot represent as readable descriptions', async () => {
    const cases: Array<[string, unknown, string, string?]> = [
      ['NaN', 'NaN', 'number'],
      ['-0', '-0', 'number'],
      ['2n ** 70n', '1180591620717411303424n', 'bigint'],
      ['Symbol("s")', 'Symbol(s)', 'symbol'],
      ['new Map([[1, "a"]])', 'Map(1) {1 => "a"}', 'object', 'map'],
      ['document.body', 'body', 'object', 'node'],
      ['({ a: 1, b: [1, 2] })', { a: 1, b: [1, 2] }, 'object'],
      ['Promise.resolve(42)', 42, 'number'],
    ];
    for (const [expression, value, type, subtype] of cases) {
      const { exitCode, data } = await evaluate(expression);
      assert.equal(exitCode, 0, expression);
      assert.deepEqual(data?.result, value, expression);
      assert.equal(data?.type, type, expression);
      assert.equal(data?.subtype, subtype, expression);
    }
    assert.equal((await evaluate('undefined')).data?.type, 'undefined');
    assert.match(String((await evaluate('window')).data?.result), /window/i);
  });

  void it('runs like the DevTools console: declarations can be repeated', async () => {
    assert.equal((await evaluate('const answer = 41; answer')).data?.result, 41);
    assert.equal((await evaluate('const answer = 42; answer')).data?.result, 42);
    assert.equal((await evaluate('await Promise.resolve(7)')).data?.result, 7);
  });

  void it('reports script exceptions as user errors', async () => {
    const { exitCode, error } = await evaluate('throw new Error("boom")');
    assert.equal(exitCode, 91);
    assert.match(error ?? '', /boom/);
  });

  void it('keeps nested values JSON would lose', async () => {
    const cases: Array<[string, unknown]> = [
      ['[1, undefined, NaN]', [1, 'undefined', 'NaN']],
      ['({ b: -0, c: Infinity })', { b: '-0', c: 'Infinity' }],
      ['({ el: document.body })', { el: 'body' }],
      ['new Uint8Array([1, 2])', [1, 2]],
    ];
    for (const [expression, value] of cases) {
      assert.deepEqual((await evaluate(expression)).data?.result, value, expression);
    }
  });

  void it('reports thrown objects and empty scripts clearly', async () => {
    assert.match((await evaluate('throw { code: 42 }')).error ?? '', /code: 42/);
    assert.equal((await evaluate('  ')).exitCode, 81);
  });

  void it('stops waiting for a promise that never settles', async () => {
    const { exitCode, error } = await evaluate('new Promise(() => {})', 60000);
    assert.equal(exitCode, 102);
    assert.match(error ?? '', /did not settle/);
  });

  void it('recovers a page kept busy by a loop started from a timer', async () => {
    assert.equal((await evaluate('setTimeout(() => { while (true) {} }, 0); 1')).exitCode, 0);
    const { exitCode, error } = await evaluate('2', 60000);
    assert.equal(exitCode, 102);
    assert.match(error ?? '', /terminated/);
    assert.equal((await evaluate('1 + 1')).data?.result, 2);
  });

  void it('terminates an endless loop and keeps the page usable', async () => {
    const { exitCode, error } = await evaluate('while (true) {}', 60000);
    assert.equal(exitCode, 102);
    assert.match(error ?? '', /terminated/);
    assert.equal((await evaluate('1 + 1')).data?.result, 2);
  });
});
