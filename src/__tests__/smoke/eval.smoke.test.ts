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

/**
 * Script that makes the page busy for good from a timer, so the eval itself
 * returns first. The timer tells the fixture server (`/beacon?busy`, a
 * synchronous request) right before it loops, so the test can wait for the
 * page to be busy instead of hoping the timer fired before its next command.
 */
const BUSY_FROM_TIMER_JS = `setTimeout(() => {
  const beacon = new XMLHttpRequest();
  beacon.open('GET', '/beacon?busy', false);
  beacon.send();
  while (true) {}
}, 0); 1`;

/**
 * Wait until the page has sent a beacon.
 *
 * @param fixture - Fixture server the page reports to
 * @param name - Beacon query string
 */
async function waitForBeacon(fixture: FixtureServer, name: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!fixture.beacons.includes(name)) {
    assert.ok(Date.now() < deadline, `the page never sent /beacon?${name}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Make the page busy from a timer and wait until it is.
 *
 * @param fixture - Fixture server the page reports to
 */
async function makePageBusy(fixture: FixtureServer): Promise<void> {
  fixture.beacons.length = 0;
  assert.equal((await evaluate(BUSY_FROM_TIMER_JS)).exitCode, 0);
  await waitForBeacon(fixture, 'busy');
}

/**
 * Console errors of the page, read once one matching `expected` was recorded
 * (errors arrive in order, so any reported before it are there too).
 *
 * @param expected - Error the page reports last
 * @returns Texts of the errors
 */
async function consoleErrorsOnceReported(expected: RegExp): Promise<string[]> {
  const deadline = Date.now() + 20000;
  for (;;) {
    const result = await runCommand('console', ['--json']);
    const { data } = JSON.parse(result.stdout) as { data: { errors: Array<{ text: string }> } };
    const texts = data.errors.map((e) => e.text);
    if (texts.some((text) => expected.test(text)) || Date.now() > deadline) return texts;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

  void it('prints string results raw in human mode and other values as JSON', async () => {
    const text = await runCommand('dom', ['eval', '"a \\"quoted\\"\\nline"'], { timeout: 60000 });
    assert.equal(text.exitCode, 0, text.stderr);
    assert.equal(text.stdout.trimEnd(), 'a "quoted"\nline');
    const object = await runCommand('dom', ['eval', '({ a: "x" })'], { timeout: 60000 });
    assert.deepEqual(JSON.parse(object.stdout), { a: 'x' });
    const number = await runCommand('dom', ['eval', '1 + 1'], { timeout: 60000 });
    assert.equal(number.stdout.trim(), '2');
    assert.equal((await evaluate('"a \\"quoted\\""')).data?.result, 'a "quoted"');
    const ambiguous = await runCommand('dom', ['eval', 'JSON.stringify([1, 2])'], {
      timeout: 60000,
    });
    assert.equal(ambiguous.stdout.trim(), '"[1,2]"');
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
      ['[1, undefined, NaN]', [1, null, 'NaN']],
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
    for (const script of ['new Promise(() => {})', 'await new Promise(() => {})']) {
      const { exitCode, error } = await evaluate(script, 60000);
      assert.equal(exitCode, 102, script);
      assert.match(error ?? '', /The awaited promise did not settle within 20s/, script);
    }
  });

  void it('recovers a busy page from other DOM commands too', async () => {
    await makePageBusy(fixture);
    const query = await runCommand('dom', ['query', 'body', '--json'], { timeout: 60000 });
    assert.equal(query.exitCode, 102, query.stdout);
    assert.match(query.stdout, /usable again/);
    assert.equal((await evaluate('1 + 1')).data?.result, 2);
  });

  void it('recovers a page kept busy by a loop started from a timer', async () => {
    await makePageBusy(fixture);
    const blocked = await evaluate('2', 60000);
    if (blocked.exitCode === 0) {
      assert.equal(blocked.data?.result, 2, "Chrome's own eval timeout stopped the loop first");
    } else {
      assert.equal(blocked.exitCode, 102);
      assert.match(blocked.error ?? '', /terminated/);
    }
    assert.equal((await evaluate('1 + 1')).data?.result, 2);
  });

  void it('terminates an endless loop and keeps the page usable', async () => {
    const { exitCode, error } = await evaluate('while (true) {}', 60000);
    assert.equal(exitCode, 102);
    assert.match(error ?? '', /terminated/);
    assert.equal((await evaluate('1 + 1')).data?.result, 2);
  });

  void it('reports a page that navigates while the script runs as 83', async () => {
    const { exitCode, error } = await evaluate(
      'location.href = "/?next"; await new Promise(() => {})'
    );
    assert.equal(exitCode, 83);
    assert.match(error ?? '', /The page navigated while the script ran/);
  });

  void it('leaves no console error for a rejection it reports, but keeps real ones', async () => {
    const navigated = await runCommand('page', ['navigate', `${fixture.url}rejections`]);
    assert.equal(navigated.exitCode, 0, navigated.stderr);
    assert.equal((await evaluate('Promise.reject(new Error("from eval"))')).exitCode, 91);
    const later = await evaluate('later()');
    assert.equal(later.exitCode, 91);
    assert.match(later.error ?? '', /page later/);
    await evaluate('setTimeout(() => Promise.reject(new Error("real page rejection"))); 1');
    assert.deepEqual(await consoleErrorsOnceReported(/real page rejection/), [
      'Uncaught (in promise) Error: real page rejection',
    ]);
  });
});
