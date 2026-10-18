/**
 * Smoke test for `bdg debug log|list|hits|clear` (logpoints, #848, part 1)
 * on the `/logpoints` fixture: the values a click's code had at a line,
 * without pausing the page; hit counters; a script that loads late; a page
 * with a `debugger;` statement; the cap on a hot loop; an expression that
 * throws; the exit codes; and logpoints surviving a reload but not `bdg stop`.
 *
 * Timing: nothing here depends on a delay. The late script is held by the
 * test's own server until the test releases it, and the wait for it to bind
 * polls `debug list` for the state change.
 */

import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { after, afterEach, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { APP_JS_LINES, UTIL_JS_LINE } from '@/__testutils__/fixturePages/logpointFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/** A logpoint as `debug list --json` shows it */
interface ListedLogpoint {
  id: string;
  file: string;
  line: number;
  expressions: string[];
  state: string;
  bound: Array<{ url: string; line: number; column: number }>;
  hits: number;
  dropped: number;
  errors: number;
  lastError?: string;
}

/** The late script: runs its function as soon as it loads */
const LATE_JS = `window.lateTotal = function () {
  var late = 41;
  return late + 1;
};
window.lateTotal();
`;

/**
 * Run a bdg command.
 *
 * @param args - Command and arguments
 * @param expectedExit - Expected exit code
 * @returns Stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<{ out: string; err: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(
    result.exitCode,
    expectedExit,
    `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`
  );
  return { out: result.stdout, err: result.stderr };
}

/**
 * Run a bdg command with `--json` and return the envelope's data.
 *
 * @param args - Command and arguments
 * @param expectedExit - Expected exit code
 * @returns `data` of the envelope
 */
async function json<T = Record<string, unknown>>(args: string[], expectedExit = 0): Promise<T> {
  const { out } = await bdg([...args, '--json'], expectedExit);
  return (JSON.parse(out) as { data: T }).data;
}

/**
 * The logpoints of the session.
 *
 * @returns `debug list` entries
 */
async function listed(): Promise<ListedLogpoint[]> {
  return (await json<{ logpoints: ListedLogpoint[] }>(['debug', 'list'])).logpoints;
}

/**
 * Evaluate an expression in the page.
 *
 * @param expression - JavaScript
 * @returns Result
 */
async function evaluate(expression: string): Promise<unknown> {
  return (await json<{ result: unknown }>(['eval', expression])).result;
}

/**
 * Start a session on the fixture page.
 *
 * @param base - Fixture server URL
 */
async function startSession(base: string): Promise<void> {
  const start = await runCommand(
    `${base}logpoints`,
    ['--port', String(await getFreePort()), '--headless'],
    { timeout: 90000 }
  );
  assert.equal(start.exitCode, 0, start.stdout + start.stderr);
}

const APP = 'app.js';
const LINE = APP_JS_LINES.returnTotal;

void describe('logpoints (#848)', () => {
  let fixtures: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixtures = await startFixtureServer();
    await startSession(fixtures.url);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixtures.close();
  });

  afterEach(async () => {
    await bdg(['debug', 'clear']);
  });

  void it('shows the values in the click report and in debug hits, without pausing the page', async () => {
    const created = await json<{ id: string; state: string; bound: Array<{ line: number }> }>([
      'debug',
      'log',
      `${APP}:${LINE}`,
      'total',
      'discount',
    ]);
    assert.match(created.id, /^lp\d+$/);
    assert.equal(created.state, 'bound');
    assert.equal(created.bound[0]?.line, LINE);

    const human = await bdg(['dom', 'click', '#checkout']);
    assert.match(
      human.out,
      new RegExp(`logpoint ${created.id} ${APP}:${LINE}: total=25 discount=0.5`)
    );
    assert.equal(await evaluate("document.getElementById('out').textContent"), 'Total: 25');

    const hits = await json<{
      hits: Array<{ id: string; values: Record<string, unknown>; navigationId: number }>;
    }>(['debug', 'hits']);
    assert.equal(hits.hits.length, 1);
    assert.deepEqual(hits.hits[0]?.values, { total: 25, discount: 0.5 });
    assert.equal(typeof hits.hits[0]?.navigationId, 'number');

    const clicked = await json<{ logpoints?: Array<{ id: string; hits: number }> }>([
      'dom',
      'click',
      '#checkout',
    ]);
    assert.equal(clicked.logpoints?.[0]?.id, created.id);
    assert.equal(clicked.logpoints?.[0]?.hits, 1);

    const consoleOut = await bdg(['console', '--json']);
    assert.ok(!consoleOut.out.includes('discount'), consoleOut.out);
  });

  void it('a hit counter shows that a button runs no code of the file', async () => {
    const created = await json<{ id: string }>(['debug', 'log', `${APP}:${LINE}`]);
    await bdg(['dom', 'click', '#noop']);
    assert.equal((await listed()).find((lp) => lp.id === created.id)?.hits, 0);
    await bdg(['dom', 'click', '#checkout']);
    assert.equal((await listed()).find((lp) => lp.id === created.id)?.hits, 1);
  });

  void it('a script that loads later is pending, then bound', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let requested: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => (requested = resolve));
    const late = http.createServer((req, res) => {
      requested();
      void held.then(() => {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(LATE_JS);
      });
      req.on('error', () => undefined);
    });
    const port = await getFreePort();
    await new Promise<void>((resolve) => late.listen(port, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${port}/late.js`;
      await bdg(['page', 'navigate', `${fixtures.url}logpoints?late=${encodeURIComponent(url)}`]);
      await bdg(['dom', 'click', '#load-late']);
      await arrived;
      const created = await json<{ id: string; state: string }>([
        'debug',
        'log',
        'late.js:3',
        'late',
      ]);
      assert.equal(created.state, 'pending');
      release();
      const deadline = Date.now() + 30000;
      for (;;) {
        const entry = (await listed()).find((lp) => lp.id === created.id);
        if (entry?.state === 'bound' && entry.hits === 1) break;
        assert.ok(Date.now() < deadline, `never bound: ${JSON.stringify(entry)}`);
      }
      const hits = await json<{ hits: Array<{ values: Record<string, unknown> }> }>([
        'debug',
        'hits',
      ]);
      assert.deepEqual(hits.hits[0]?.values, { late: 41 });
    } finally {
      release();
      await new Promise((resolve) => late.close(resolve));
      await bdg(['page', 'navigate', `${fixtures.url}logpoints`]);
    }
  });

  void it('a debugger; statement does not hold the page while a logpoint exists, also after a reload', async () => {
    await bdg(['debug', 'log', `${APP}:${LINE}`]);
    await bdg(['dom', 'click', '#pause']);
    assert.equal(await evaluate("document.getElementById('out').textContent"), 'Resumed');
    await bdg(['page', 'reload']);
    await bdg(['dom', 'click', '#pause']);
    assert.equal(await evaluate("document.getElementById('out').textContent"), 'Resumed');
  });

  void it('caps a hot loop: 100 hits stored, the rest counted as dropped', async () => {
    const created = await json<{ id: string }>([
      'debug',
      'log',
      `${APP}:${APP_JS_LINES.loopBody}`,
      'n',
    ]);
    await bdg(['dom', 'click', '#loop']);
    const entry = (await listed()).find((lp) => lp.id === created.id);
    assert.equal(entry?.hits, 10000);
    assert.equal(entry?.dropped, 9900);
    const hits = await json<{ hits: unknown[] }>(['debug', 'hits', created.id, '--last', '1000']);
    assert.equal(hits.hits.length, 100);
  });

  void it('an expression that throws is reported on its logpoint and does not affect the click', async () => {
    const created = await json<{ id: string }>([
      'debug',
      'log',
      `${APP}:${LINE}`,
      'missingVariable',
    ]);
    await bdg(['dom', 'click', '#checkout']);
    assert.equal(await evaluate("document.getElementById('out').textContent"), 'Total: 25');
    const entry = (await listed()).find((lp) => lp.id === created.id);
    assert.ok((entry?.errors ?? 0) >= 1, JSON.stringify(entry));
    assert.match(entry?.lastError ?? '', /ReferenceError: missingVariable is not defined/);
  });

  void it('the click report says that the expression threw, human and JSON', async () => {
    const created = await json<{ id: string }>([
      'debug',
      'log',
      `${APP}:${LINE}`,
      'missingVariable',
    ]);
    const human = await bdg(['dom', 'click', '#checkout']);
    assert.match(
      human.out,
      new RegExp(
        `logpoint ${created.id} ${APP}:${LINE}: missingVariable threw ReferenceError: missingVariable is not defined`
      )
    );
    const clicked = await json<{
      logpoints?: Array<{ id: string; error?: string; errors?: number; hits: number }>;
    }>(['dom', 'click', '#checkout']);
    const entry = clicked.logpoints?.find((lp) => lp.id === created.id);
    assert.match(entry?.error ?? '', /ReferenceError: missingVariable is not defined/);
    assert.equal(entry?.errors, 1);
  });

  void it('one bad expression does not hide the others, in the report and in debug hits', async () => {
    const created = await json<{ id: string }>([
      'debug',
      'log',
      `${APP}:${LINE}`,
      'missing',
      'total',
      'discount',
    ]);
    const human = await bdg(['dom', 'click', '#checkout']);
    assert.match(
      human.out,
      /logpoint lp\d+ app\.js:8: total=25 discount=0.5 missing threw ReferenceError: missing is not defined/
    );
    const clicked = await json<{
      logpoints?: Array<{
        values: Record<string, unknown>;
        failed?: Record<string, string>;
        errors?: number;
      }>;
    }>(['dom', 'click', '#checkout']);
    assert.deepEqual(clicked.logpoints?.[0]?.values, { total: 25, discount: 0.5 });
    assert.match(clicked.logpoints?.[0]?.failed?.['missing'] ?? '', /ReferenceError/);
    assert.equal(clicked.logpoints?.[0]?.errors, 1);
    const hits = await json<{
      hits: Array<{ values: Record<string, unknown>; errors?: Record<string, string> }>;
    }>(['debug', 'hits', created.id]);
    assert.equal(hits.hits.length, 2);
    assert.deepEqual(hits.hits[0]?.values, { total: 25, discount: 0.5 });
    assert.match(hits.hits[0]?.errors?.['missing'] ?? '', /ReferenceError/);
    assert.match(
      (await bdg(['debug', 'hits', created.id])).out,
      /total=25 discount=0.5 missing threw ReferenceError/
    );
    assert.equal((await listed()).find((lp) => lp.id === created.id)?.errors, 2);
  });

  void it('a guard that throws logs no hit, counts the error and shows it in debug hits', async () => {
    const created = await json<{ id: string }>([
      'debug',
      'log',
      `${APP}:${LINE}`,
      'total',
      '--if',
      'missing',
    ]);
    const human = await bdg(['dom', 'click', '#checkout']);
    assert.match(
      human.out,
      /logpoint lp\d+ app\.js:8 threw ReferenceError: missing is not defined/
    );
    const hits = await json<{ hits: Array<{ error?: string; values: object }> }>([
      'debug',
      'hits',
      created.id,
    ]);
    assert.match(hits.hits[0]?.error ?? '', /ReferenceError/);
    assert.deepEqual(hits.hits[0]?.values, {});
    assert.equal((await listed()).find((lp) => lp.id === created.id)?.errors, 1);
  });

  void it('a variable declared on the logpoint line gets the hint', async () => {
    await bdg(['debug', 'log', `${APP}:${APP_JS_LINES.tdzDecl}`, 'early']);
    const human = await bdg(['dom', 'click', '#tdz']);
    assert.match(
      human.out,
      /early threw .*Cannot access 'early'.*set the logpoint on the next line/
    );
    const entry = (await listed())[0];
    assert.match(entry?.lastError ?? '', /set the logpoint on the next line/);
  });

  void it('hits carry the script URL: two util.js in different directories bind both', async () => {
    await bdg(['page', 'navigate', `${fixtures.url}logpoint-utils`]);
    try {
      const created = await json<{ id: string; bound: Array<{ url: string }> }>([
        'debug',
        'log',
        `util.js:${UTIL_JS_LINE}`,
        'which',
      ]);
      assert.equal(created.bound.length, 2);
      const human = await bdg(['dom', 'click', '#both']);
      assert.match(human.out, /\[[^\]]*\/logpoints\/a\/util\.js\]: which="a"/);
      assert.match(human.out, /\[[^\]]*\/logpoints\/b\/util\.js\]: which="b"/);
      const clicked = await json<{
        logpoints?: Array<{ url?: string; values: { which?: string } }>;
      }>(['dom', 'click', '#both']);
      assert.deepEqual(
        clicked.logpoints?.map((lp) => [lp.url?.replace(/^.*\/logpoints\//, ''), lp.values.which]),
        [
          ['a/util.js', 'a'],
          ['b/util.js', 'b'],
        ]
      );
      const hits = await json<{ hits: Array<{ url?: string; values: { which?: string } }> }>([
        'debug',
        'hits',
        created.id,
      ]);
      const seen = hits.hits.map(
        (hit) => `${hit.url?.replace(/^.*\/logpoints\//, '')}=${hit.values.which}`
      );
      assert.deepEqual(seen.slice(-2), ['a/util.js=a', 'b/util.js=b']);
      const text = await bdg(['debug', 'hits', created.id]);
      assert.match(text.out, /\/logpoints\/a\/util\.js\]/);
    } finally {
      await bdg(['page', 'navigate', `${fixtures.url}logpoints`]);
    }
  });

  void it('a file no loaded script matches is pending (exit 0) with a warning and a suggestion', async () => {
    const human = await bdg(['debug', 'log', 'ap.js:3']);
    assert.match(human.out, /lp\d+ pending/);
    assert.match(
      human.err,
      /^Warning: No loaded script matches "ap\.js".*Did you mean: app\.js\?/m
    );
    const created = await json<{ state: string; warning?: string }>([
      'debug',
      'log',
      'nothing.js:3',
    ]);
    assert.equal(created.state, 'pending');
    assert.equal(created.warning, undefined);
    const { out } = await bdg(['debug', 'log', 'nothing.js:4', '--json']);
    const envelope = JSON.parse(out) as { warnings?: string[]; data: { state: string } };
    assert.equal(envelope.data.state, 'pending');
    assert.match(envelope.warnings?.[0] ?? '', /No loaded script matches "nothing\.js"/);
  });

  void it('an error that cannot be read or is huge does not escape the condition or grow the output', async () => {
    const hostile = '(()=>{throw {get name(){throw 1},get message(){throw 2}}})()';
    const huge = '(()=>{throw new Error("x".repeat(1e6))})()';
    const created = await json<{ id: string }>([
      'debug',
      'log',
      `${APP}:${LINE}`,
      'total',
      hostile,
      huge,
    ]);
    const clicked = await json<{
      errors?: unknown[];
      logpoints?: Array<{ values: Record<string, unknown>; failed?: Record<string, string> }>;
    }>(['dom', 'click', '#checkout']);
    assert.equal(clicked.errors, undefined, JSON.stringify(clicked.errors));
    assert.deepEqual(clicked.logpoints?.[0]?.values, { total: 25 });
    assert.equal(clicked.logpoints?.[0]?.failed?.[hostile], '(error)');
    assert.ok(JSON.stringify(clicked).length < 20000);
    const hits = await bdg(['debug', 'hits', created.id, '--json']);
    assert.ok(hits.out.length < 5000, `${hits.out.length}`);
    const list = await bdg(['debug', 'list']);
    assert.ok(list.out.length < 2000, `${list.out.length}`);
  });

  void it('exit codes', async () => {
    await bdg(['debug', 'log', `${APP}:999`], 83);
    await bdg(['debug', 'log', `${APP}:${APP_JS_LINES.last + 1}`], 83);
    await bdg(['debug', 'log', APP], 81);
    await bdg(['debug', 'log', `${APP}:${LINE}`, 'foo('], 81);
    await bdg(['debug', 'clear', 'lp999'], 83);
  });

  void it('refuses an expression that changes the structure of the condition (81)', async () => {
    await bdg(['debug', 'log', `${APP}:${LINE}`, 'a) ; window.__evil = 1; (b'], 81);
    await bdg(['debug', 'log', `${APP}:${LINE}`, '1), (2'], 81);
    await bdg(['debug', 'log', `${APP}:${LINE}`, 'total', '--if', '1), (2'], 81);
    assert.deepEqual(await listed(), []);
  });

  void it('prints a long value cut, and keeps it whole in JSON', async () => {
    await bdg(['debug', 'log', `${APP}:${LINE}`, "'x'.repeat(1000)"]);
    const human = await bdg(['dom', 'click', '#checkout']);
    const line = human.out.split('\n').find((l) => l.startsWith('logpoint ')) ?? '';
    assert.ok(line.includes('…') && line.length < 400, line);
    const hits = await json<{ hits: Array<{ values: Record<string, string> }> }>(['debug', 'hits']);
    assert.equal(Object.values(hits.hits[0]?.values ?? {})[0]?.length, 1000);
  });

  void it('logpoints survive a tab switch, fire on the new tab and come back', async () => {
    const created = await json<{ id: string }>(['debug', 'log', `${APP}:${LINE}`, 'total']);
    await bdg(['dom', 'click', '#open-tab']);
    await bdg(['page', 'switch', '1']);
    assert.equal((await listed()).length, 1);
    const status = await json<{ activity: { logpoints?: number } }>(['status']);
    assert.equal(status.activity.logpoints, 1);
    const clicked = await json<{ logpoints?: Array<{ id: string; hits: number }> }>([
      'dom',
      'click',
      '#checkout',
    ]);
    assert.equal(clicked.logpoints?.[0]?.id, created.id);
    await bdg(['page', 'switch', '0']);
    assert.equal((await listed()).length, 1);
    const back = await json<{ logpoints?: Array<{ id: string }> }>(['dom', 'click', '#checkout']);
    assert.equal(back.logpoints?.[0]?.id, created.id);
    const tabs = await json<{ tabs: Array<{ index: number }> }>(['page', 'tabs']);
    await bdg(['page', 'close', String(tabs.tabs.length - 1)]);
  });

  void it('refuses a duplicate location (84), bad syntax (81) and an 11th logpoint (81)', async () => {
    await bdg(['debug', 'log', `${APP}:${LINE}`]);
    await bdg(['debug', 'log', `${APP}:${LINE}`], 84);
    await bdg(['debug', 'log', `${APP}:${APP_JS_LINES.discount}`, 'foo('], 81);
    await bdg(['debug', 'clear']);
    const lines = APP_JS_LINES.codeLines;
    for (const line of lines.slice(0, 10)) await bdg(['debug', 'log', `${APP}:${line}`]);
    await bdg(['debug', 'log', `${APP}:${lines[10]}`], 81);
  });

  void it('survive a reload, and bdg stop clears them', async () => {
    const created = await json<{ id: string }>(['debug', 'log', `${APP}:${LINE}`, 'total']);
    const status = await json<{ activity: { logpoints?: number } }>(['status']);
    assert.equal(status.activity.logpoints, 1);
    await bdg(['page', 'reload']);
    await bdg(['dom', 'click', '#checkout']);
    assert.equal((await listed()).find((lp) => lp.id === created.id)?.hits, 1);
    await bdg(['stop']);
    await startSession(fixtures.url);
    assert.deepEqual(await listed(), []);
  });
});
