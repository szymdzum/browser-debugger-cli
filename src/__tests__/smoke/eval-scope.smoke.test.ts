/**
 * `bdg dom eval` scope smoke test (#743).
 *
 * A dom eval script's top-level `const`/`let`/`class` stay local to that
 * eval: they are not left in the page's global lexical scope, where they
 * would collide with a later `bdg cdp Runtime.evaluate` or a page script.
 * `var` and function declarations stay global, as explicit globals. Each
 * row of the case matrix checks the printed value, the `--json` value, the
 * exit code and the globals left behind; console messages and errors name
 * the script `bdg-eval`, at the user's line and column.
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

interface Envelope {
  data?: { result?: unknown; type?: string };
  error?: string;
}

/** One script of the case matrix */
interface ScopeCase {
  script: string;
  /** Exit code */
  exitCode: number;
  /** `--json` result (success) */
  result?: unknown;
  /** `--json` type (success) */
  type?: string;
  /** Human output (success) */
  printed?: string;
  /** Error text (failure) */
  error?: RegExp;
  /** `typeof` of names in the page afterwards */
  globals?: Record<string, string>;
}

const CASES: ScopeCase[] = [
  {
    script: 'const sc1 = 1; sc1',
    exitCode: 0,
    result: 1,
    printed: '1',
    globals: { sc1: 'undefined' },
  },
  {
    script: 'const sc1 = 1; sc1',
    exitCode: 0,
    result: 1,
    printed: '1',
    globals: { sc1: 'undefined' },
  },
  {
    script: 'let sc2 = 2; sc2',
    exitCode: 0,
    result: 2,
    printed: '2',
    globals: { sc2: 'undefined' },
  },
  {
    script: 'class Sc3 {}; Sc3.name',
    exitCode: 0,
    result: 'Sc3',
    printed: 'Sc3',
    globals: { Sc3: 'undefined' },
  },
  {
    script: 'function sc4() { return 4 } sc4()',
    exitCode: 0,
    result: 4,
    printed: '4',
    globals: { sc4: 'function' },
  },
  { script: 'var sc5 = 5; sc5', exitCode: 0, result: 5, printed: '5', globals: { sc5: 'number' } },
  {
    script: 'const sc6 = await Promise.resolve(6); sc6',
    exitCode: 0,
    result: 6,
    printed: '6',
    globals: { sc6: 'undefined' },
  },
  { script: '{a:1}', exitCode: 0, result: 1, printed: '1' },
  { script: '({a:1})', exitCode: 0, result: { a: 1 }, printed: '{\n  "a": 1\n}' },
  { script: '7 // trailing comment', exitCode: 0, result: 7, printed: '7' },
  {
    script: 'const sc8 = 8',
    exitCode: 0,
    type: 'undefined',
    printed: 'undefined',
    globals: { sc8: 'undefined' },
  },
  {
    script: 'const sc9 = 9;\n)',
    exitCode: 91,
    error: /^SyntaxError: Unexpected token '\)'\n {4}at bdg-eval:2:1$/,
  },
  { script: 'throw new Error("x")', exitCode: 91, error: /^Error: x\n {4}at bdg-eval:1:7$/ },
  {
    script: '1;\nthrow new Error("y")',
    exitCode: 91,
    error: /^Error: y\n {4}at bdg-eval:2:7$/,
  },
  {
    script: '"use strict"; sc10 = 10',
    exitCode: 91,
    error: /^ReferenceError: sc10 is not defined\n {4}at bdg-eval:1:20$/,
    globals: { sc10: 'undefined' },
  },
  {
    script: '// hi\n"use strict"; sc11 = 1',
    exitCode: 91,
    error: /^ReferenceError: sc11 is not defined/,
  },
  { script: '"use strict".length; sc12 = 1; 3', exitCode: 0, result: 3, printed: '3' },
  { script: '#!/usr/bin/env node\n1', exitCode: 0, result: 1, printed: '1' },
  { script: '} {', exitCode: 91, error: /^SyntaxError: Unexpected token '\}'/ },
  {
    script: '}; window.sc13 = 1; {',
    exitCode: 91,
    error: /^SyntaxError/,
    globals: { sc13: 'undefined' },
  },
  {
    script: 'throw new Error("see bdg-eval:5:1")',
    exitCode: 91,
    error: /^Error: see bdg-eval:5:1\n {4}at bdg-eval:1:7$/,
  },
  { script: 'return 1', exitCode: 91, error: /^SyntaxError: Illegal return statement/ },
];

/**
 * Run a bdg command with `--json`.
 *
 * @param args - Command arguments
 * @returns Exit code and envelope
 */
async function runJson(args: string[]): Promise<{ exitCode: number } & Envelope> {
  const result = await runCommand(args[0] ?? '', [...args.slice(1), '--json'], { timeout: 60000 });
  return { exitCode: result.exitCode, ...(JSON.parse(result.stdout) as Envelope) };
}

/**
 * `typeof` of a name in the page, read with a plain `Runtime.evaluate`.
 *
 * @param name - Global name
 * @param frame - Frame to read in (`dom eval --frame`), else the page
 * @returns The type
 */
async function typeOfGlobal(name: string, frame?: string): Promise<unknown> {
  if (frame) {
    return (await runJson(['dom', 'eval', `typeof ${name}`, '--frame', frame])).data?.result;
  }
  const params = JSON.stringify({ expression: `typeof ${name}`, returnByValue: true });
  const result = await runJson(['cdp', 'Runtime.evaluate', '--params', params]);
  return (result.data as { result?: { result?: { value?: unknown } } } | undefined)?.result?.result
    ?.value;
}

void describe('dom eval scope', () => {
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

  void it('keeps values, exit codes and errors, and leaves only explicit globals', async () => {
    for (const row of CASES) {
      const json = await runJson(['dom', 'eval', row.script]);
      assert.equal(json.exitCode, row.exitCode, `${row.script}: ${json.error ?? ''}`);
      if (row.error) {
        assert.match(json.error ?? '', row.error, row.script);
      } else {
        if ('result' in row) assert.deepEqual(json.data?.result, row.result, row.script);
        if (row.type) assert.equal(json.data?.type, row.type, row.script);
        const human = await runCommand('dom', ['eval', row.script], { timeout: 60000 });
        assert.equal(human.stdout.trimEnd(), row.printed, row.script);
      }
      for (const [name, type] of Object.entries(row.globals ?? {})) {
        assert.equal(await typeOfGlobal(name), type, `${row.script}: typeof ${name}`);
      }
    }
  });

  void it('leaves the name free for bdg cdp and a later page script', async () => {
    assert.equal((await runJson(['dom', 'eval', 'const t = 1; t'])).data?.result, 1);
    assert.equal((await runJson(['dom', 'eval', 'const t = 1; t'])).data?.result, 1);
    const params = JSON.stringify({ expression: 'const t = 2; t', returnByValue: true });
    const cdp = await runJson(['cdp', 'Runtime.evaluate', '--params', params]);
    assert.equal(cdp.exitCode, 0, cdp.error);
    const pageScript = `const s = document.createElement('script');
s.textContent = 'let pageT = 5; window.pageScriptRan = pageT';
document.head.append(s); window.pageScriptRan`;
    assert.equal((await runJson(['dom', 'eval', 'let pageT = 1; pageT'])).data?.result, 1);
    assert.equal((await runJson(['dom', 'eval', pageScript])).data?.result, 5);
  });

  void it('names console messages bdg-eval at the line and column of the script', async () => {
    assert.equal((await runJson(['dom', 'eval', 'console.error("from-eval-743"); 1'])).exitCode, 0);
    const json = await runJson(['console']);
    const errors = (json.data as unknown as { errors: Array<{ text: string; source?: unknown }> })
      .errors;
    const logged = errors.find((entry) => entry.text === 'from-eval-743');
    assert.deepEqual(logged?.source, { url: 'bdg-eval', line: 1, column: 9 });
    const human = await runCommand('console', [], { timeout: 60000 });
    assert.match(human.stdout, /bdg-eval:1:9/);
  });

  void it('keeps --frame declarations local to the frame eval', async () => {
    const navigated = await runCommand('page', ['navigate', `${fixture.url}eval-frames`]);
    assert.equal(navigated.exitCode, 0, navigated.stderr);
    for (let run = 0; run < 2; run++) {
      const first = await runJson(['dom', 'eval', 'const fr = 3; fr', '--frame', 'same']);
      assert.equal(first.data?.result, 3, first.error);
    }
    assert.equal(await typeOfGlobal('fr', 'same'), 'undefined');
  });
});
