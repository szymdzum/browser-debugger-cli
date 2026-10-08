/**
 * Bounded `dom eval --json` smoke test (#478).
 *
 * On a page with 20,000 elements, an array or object result in `--json`
 * stays within about 20 KB and says how much it left out (`count`/`omitted`,
 * or `truncatedFrom` when only the start of its JSON text fits), and
 * `--full` returns the whole value.
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

const DIV_COUNT = 20_000;

const SETUP_SCRIPT = `document.body.insertAdjacentHTML('beforeend', Array.from({ length: ${DIV_COUNT} }, (_, i) => '<div class="row" data-i="' + i + '">Row ' + i + '</div>').join('')); 1`;

/** Every element's HTML; `html` and `body` hold the whole page, so 3 MB of JSON */
const ALL_HTML = "[...document.querySelectorAll('*')].map(e => e.outerHTML)";

/** Most bytes a bounded `--json` eval prints */
const MAX_JSON_BYTES = 25_000;

interface EvalData {
  result: unknown;
  type: string;
  count?: number;
  omitted?: number;
  truncatedFrom?: number;
}

/**
 * Run `dom eval <expression> --json` and assert it succeeded.
 *
 * @param expression - Script
 * @param extra - Extra flags
 * @returns Stdout and its parsed data
 */
async function evalJson(
  expression: string,
  extra: string[] = []
): Promise<{ stdout: string; data: EvalData }> {
  const result = await runCommand('dom', ['eval', expression, '--json', ...extra], {
    timeout: 60000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  return { stdout: result.stdout, data: (JSON.parse(result.stdout) as { data: EvalData }).data };
}

void describe('dom eval --json bounds', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = String(await getFreePort());
    const started = await runCommand(`${fixture.url}interactions`, ['--port', port, '--headless'], {
      timeout: 60000,
    });
    assert.equal(started.exitCode, 0, started.stderr);
    await evalJson(SETUP_SCRIPT);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('lists the first 100 elements of a long array with count and omitted', async () => {
    const { stdout, data } = await evalJson(
      "[...document.querySelectorAll('div.row')].map(e => e.dataset.i)"
    );
    assert.ok(stdout.length < MAX_JSON_BYTES, `${stdout.length} bytes`);
    assert.ok(Array.isArray(data.result));
    assert.equal(data.result.length, 100);
    assert.equal(data.count, DIV_COUNT);
    assert.equal(data.omitted, DIV_COUNT - 100);
  });

  void it('cuts an array still over the cap to the start of its JSON text', async () => {
    const { stdout, data } = await evalJson(ALL_HTML);
    assert.ok(stdout.length < MAX_JSON_BYTES, `${stdout.length} bytes`);
    assert.equal(typeof data.result, 'string');
    assert.ok((data.result as string).startsWith('["<html'));
    assert.ok((data.count ?? 0) > DIV_COUNT, `count ${data.count}`);
    assert.equal(data.omitted, undefined);
    assert.ok((data.truncatedFrom ?? 0) > 1_000_000, `truncatedFrom ${data.truncatedFrom}`);
  });

  void it('cuts an object over the cap to the start of its JSON text', async () => {
    const { stdout, data } = await evalJson(
      "Object.fromEntries([...document.querySelectorAll('div.row')].map(e => [e.dataset.i, e.outerHTML]))"
    );
    assert.ok(stdout.length < MAX_JSON_BYTES, `${stdout.length} bytes`);
    assert.equal(data.type, 'object');
    assert.ok((data.result as string).startsWith('{"0":"<div class=\\"row\\"'));
    assert.ok((data.truncatedFrom ?? 0) > 40_000, `truncatedFrom ${data.truncatedFrom}`);
  });

  void it('--full returns every element of an array over 1000 entries', async () => {
    const { data } = await evalJson(
      "[...document.querySelectorAll('div.row')].slice(0, 1500).map(e => e.dataset.i)",
      ['--full']
    );
    assert.ok(Array.isArray(data.result));
    assert.equal(data.result.length, 1500);
    assert.ok(!data.result.includes('…'));
    assert.equal(data.result[1499], '1499');
  });

  void it('--full returns the whole value, of which the bounded result is the start', async () => {
    const firstRows = "[...document.querySelectorAll('*')].slice(0, 1000).map(e => e.outerHTML)";
    const { data } = await evalJson(firstRows, ['--full']);
    assert.ok(Array.isArray(data.result));
    assert.equal(data.count, undefined);
    assert.equal(data.truncatedFrom, undefined);
    const json = JSON.stringify(data.result);
    const bounded = (await evalJson(firstRows)).data;
    assert.equal(bounded.truncatedFrom, json.length);
    assert.ok(json.startsWith(bounded.result as string));
  });
});
