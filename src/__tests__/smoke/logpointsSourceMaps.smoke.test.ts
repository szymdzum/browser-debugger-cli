/**
 * Smoke test for `bdg debug log` on bundles with source maps (#848, part 2)
 * on the `/source-maps` fixture: the agent gives the original file and line
 * (`src/cart.ts:7`), bdg binds the generated position, hits and reports show
 * the original place. External and inline maps, a one-line minified bundle
 * (the column picks the right function), a line with no code, maps that
 * cannot be used, and a lazily loaded script with a map.
 *
 * Timing: nothing here depends on a delay. The lazy script is served by the
 * test's own server and the wait for it to bind polls `debug list` for the
 * state change.
 */

import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { after, afterEach, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  CART_LINES,
  INLINE_LINES,
  PAIR_LINES,
} from '@/__testutils__/fixturePages/sourceMapFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { anchorSegments, buildSourceMap } from '@/__testutils__/sourceMapBuilder.js';

/** A logpoint as `debug log` and `debug list` show it in `--json` */
interface Logged {
  id: string;
  state: string;
  warning?: string;
  bound: Array<{
    url: string;
    line: number;
    column: number;
    source?: { file: string; line: number };
  }>;
  hits?: number;
}

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
 * Run a bdg command with `--json`; the envelope's data (an error envelope's
 * whole body when an error exit is expected).
 *
 * @param args - Command and arguments
 * @param expectedExit - Expected exit code
 * @returns `data` of the envelope
 */
async function json<T = Record<string, unknown>>(args: string[], expectedExit = 0): Promise<T> {
  const { out } = await bdg([...args, '--json'], expectedExit);
  const body = JSON.parse(out) as { data?: T; error?: string };
  return (expectedExit === 0 ? body.data : body) as T;
}

/**
 * Values of the hits of a logpoint on the page now loaded.
 *
 * @param id - Logpoint id
 * @returns Values of each hit, oldest first
 */
async function hitValues(id: string): Promise<Array<Record<string, unknown>>> {
  const hits = await json<{ hits: Array<{ values: Record<string, unknown> }> }>([
    'debug',
    'hits',
    id,
  ]);
  return hits.hits.map((hit) => hit.values);
}

/**
 * The logpoints of the session.
 *
 * @returns `debug list` entries
 */
async function listed(): Promise<Logged[]> {
  return (await json<{ logpoints: Logged[] }>(['debug', 'list'])).logpoints;
}

void describe('logpoints on source-mapped bundles (#848, part 2)', () => {
  let fixtures: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixtures = await startFixtureServer();
    const start = await runCommand(
      `${fixtures.url}source-maps`,
      ['--port', String(await getFreePort()), '--headless'],
      { timeout: 90000 }
    );
    assert.equal(start.exitCode, 0, start.stdout + start.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixtures.close();
  });

  afterEach(async () => {
    await bdg(['debug', 'clear']);
  });

  void it('src/cart.ts:7 binds the generated line, and hits and reports name the original', async () => {
    const created = await json<Logged>([
      'debug',
      'log',
      `src/cart.ts:${CART_LINES.returnTotal}`,
      'total',
      'discount',
    ]);
    assert.equal(created.state, 'bound');
    assert.match(created.bound[0]?.url ?? '', /\/sm\/dist\/app\.js$/);
    assert.equal(created.bound[0]?.line, 8);
    assert.ok((created.bound[0]?.column ?? 0) >= 1);
    assert.equal(created.bound[0]?.source?.line, CART_LINES.returnTotal);
    assert.match(created.bound[0]?.source?.file ?? '', /src\/cart\.ts$/);

    const human = await bdg(['dom', 'click', '#checkout']);
    assert.match(
      human.out,
      new RegExp(
        `logpoint ${created.id} src/cart\\.ts:${CART_LINES.returnTotal}: total=25 discount=0.5`
      )
    );
    assert.deepEqual(await hitValues(created.id), [{ total: 25, discount: 0.5 }]);

    const entry = (await listed()).find((lp) => lp.id === created.id);
    assert.equal(entry?.hits, 1);
    const text = await bdg(['debug', 'list']);
    assert.match(
      text.out,
      new RegExp(`${created.id}\\s+src/cart\\.ts:${CART_LINES.returnTotal}\\s+bound`)
    );
  });

  void it('a column picks the segment at or before it', async () => {
    const created = await json<Logged>([
      'debug',
      'log',
      `src/cart.ts:${CART_LINES.discount}:3`,
      'subtotal',
    ]);
    assert.equal(created.state, 'bound');
    await bdg(['dom', 'click', '#checkout']);
    assert.deepEqual(await hitValues(created.id), [{ subtotal: 25.5 }]);
  });

  void it('a one-line minified bundle: the original line in the second function fires for it, not for the first', async () => {
    const created = await json<Logged>(['debug', 'log', `src/pair.ts:${PAIR_LINES.inSecond}`, 'a']);
    assert.equal(created.state, 'bound');
    assert.equal(created.bound[0]?.line, 1);
    assert.ok((created.bound[0]?.column ?? 0) > 1, 'bound by the column of the segment');

    await bdg(['dom', 'click', '#first']);
    assert.equal((await listed()).find((lp) => lp.id === created.id)?.hits, 0);
    await bdg(['dom', 'click', '#second']);
    assert.deepEqual(await hitValues(created.id), [{ a: 5 }]);
  });

  void it('an inline data: map works', async () => {
    const created = await json<Logged>([
      'debug',
      'log',
      `src/inline.ts:${INLINE_LINES.sum}`,
      'a',
      'b',
    ]);
    assert.equal(created.state, 'bound');
    assert.match(created.bound[0]?.url ?? '', /\/sm\/dist\/inline\.js$/);
    await bdg(['dom', 'click', '#inline']);
    assert.deepEqual(await hitValues(created.id), [{ a: 3, b: 4 }]);
  });

  void it('a line that compiles to nothing is 83 with the original name', async () => {
    const failed = await json<{ error: string }>(
      ['debug', 'log', `src/cart.ts:${CART_LINES.typeOnly}`, 'x'],
      83
    );
    assert.match(
      failed.error,
      new RegExp(`src/cart\\.ts has no code at line ${CART_LINES.typeOnly}`)
    );
    assert.deepEqual(await listed(), []);
  });

  void it('two original places that compile to the same position: the second is 84 and leaves nothing behind', async () => {
    const first = await json<Logged>([
      'debug',
      'log',
      `src/cart.ts:${CART_LINES.returnTotal}`,
      'total',
    ]);
    const failed = await json<{ error: string }>(
      ['debug', 'log', `src/cart.ts:${CART_LINES.returnTotal}:5`, 'discount'],
      84
    );
    assert.match(failed.error, /already has a breakpoint/);
    assert.deepEqual(
      (await listed()).map((lp) => lp.id),
      [first.id]
    );
  });

  void it('survives a reload: the logpoint still fires and is still bound', async () => {
    const created = await json<Logged>([
      'debug',
      'log',
      `src/cart.ts:${CART_LINES.returnTotal}`,
      'total',
    ]);
    await bdg(['page', 'reload']);
    await bdg(['dom', 'click', '#checkout']);
    assert.deepEqual(await hitValues(created.id), [{ total: 25 }]);
    const entry = (await listed()).find((lp) => lp.id === created.id);
    assert.equal(entry?.bound[0]?.source?.line, CART_LINES.returnTotal);
  });

  void it('a file no map names is pending, and the warning says which maps could not be used', async () => {
    const { out } = await bdg(['debug', 'log', 'src/ghost.ts:2', 'x', '--json']);
    const envelope = JSON.parse(out) as { warnings?: string[]; data: Logged };
    assert.equal(envelope.data.state, 'pending');
    const warning = envelope.warnings?.[0] ?? '';
    assert.match(warning, /src\/ghost\.ts/);
    assert.match(warning, /missing\.js\.map: HTTP 404/);
    assert.match(warning, /bad\.js\.map: not valid JSON/);
    assert.match(warning, /sections/);
    const human = await bdg(['debug', 'log', 'src/ghost.ts:3', 'x']);
    assert.match(
      human.err,
      /^Warning: No loaded script or readable source map names "src\/ghost\.ts"/m
    );
  });

  void it('a script loaded later with a map binds the pending logpoint', async () => {
    const lazyJs = [
      'window.lazyRun = function (x) {',
      '  var y = x + 1;',
      '  return y;',
      '};',
      '//# sourceMappingURL=lazy.js.map',
    ];
    const lazyMap = buildSourceMap({
      sources: ['src/lazy.ts'],
      segments: anchorSegments(lazyJs, [
        { genLine: 0, needle: 'window', source: 0, origLine: 1 },
        { genLine: 1, needle: 'var y', source: 0, origLine: 2, origColumn: 2 },
        { genLine: 2, needle: 'return', source: 0, origLine: 3, origColumn: 2 },
      ]),
    });
    const server = http.createServer((req, res) => {
      const body = req.url === '/lazy.js.map' ? lazyMap : lazyJs.join('\n');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(body);
    });
    const port = await getFreePort();
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${port}/lazy.js`;
      await bdg(['page', 'navigate', `${fixtures.url}source-maps`]);
      const created = await json<Logged>(['debug', 'log', 'src/lazy.ts:2', 'x']);
      assert.equal(created.state, 'pending');
      await bdg([
        'eval',
        `new Promise(function (resolve) { var s = document.createElement('script'); s.src = ${JSON.stringify(url)}; s.onload = resolve; document.head.appendChild(s); })`,
      ]);
      const deadline = Date.now() + 30000;
      for (;;) {
        const entry = (await listed()).find((lp) => lp.id === created.id);
        if (entry?.state === 'bound') break;
        assert.ok(Date.now() < deadline, `never bound: ${JSON.stringify(entry)}`);
      }
      await bdg(['eval', 'window.lazyRun(41)']);
      assert.deepEqual(await hitValues(created.id), [{ x: 41 }]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
