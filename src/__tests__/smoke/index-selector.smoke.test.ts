/**
 * Index selector smoke test (#630).
 *
 * `data.selector` in the result of an action on an `a11y query` index is a
 * real selector that finds that element again with `dom query`, never the
 * cache's `a11y ...` key: `#id` for an element with an id, a path for one
 * without, and one for an element in an open shadow root. When no selector
 * finds only that element (one in a frame, or in a shadow root whose path
 * matches other elements: selectors do not cross shadow roots) the result has
 * none. `dom query` indices and selector targets keep the
 * selector they were given.
 */

import * as assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Parse a `--json` run's `data`.
 *
 * @param args - bdg arguments (without `--json`)
 * @returns `data` of the response
 */
async function dataOf(args: string[]): Promise<Record<string, unknown>> {
  const output = await bdg([...args, '--json']);
  return (JSON.parse(output) as { data: Record<string, unknown> }).data;
}

/**
 * Click the first match of an a11y query by its index and return the
 * `selector` of the result.
 *
 * @param name - Accessible name of the button
 * @returns `data.selector`, when the result has one
 */
async function selectorAfterClick(name: string): Promise<string | undefined> {
  await bdg(['dom', 'a11y', 'query', `role=button name=${name}`]);
  const data = await dataOf(['dom', 'click', '0']);
  assert.equal(data['element'] !== undefined, true, 'the click result describes the element');
  return data['selector'] as string | undefined;
}

/**
 * The clicks the page noted since the last reset.
 *
 * @returns Comma-separated notes
 */
async function clicksOnPage(): Promise<string> {
  return String((await dataOf(['eval', 'window.clicks.join()']))['result']);
}

void describe('Selector in the result of an action on an index', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}index-selector`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  beforeEach(async () => {
    await bdg(['eval', 'window.clicks = []; 1']);
  });

  void it('is #id for an element with an id, and finds it again', async () => {
    const selector = await selectorAfterClick('WithId');
    assert.equal(selector, '#with-id');
    const found = await bdg(['dom', 'query', selector ?? '']);
    assert.match(found, /Found 1 node/);
    assert.match(found, /WithId/);
  });

  void it('is a path for an element without an id, and finds it again', async () => {
    const selector = await selectorAfterClick('Plain');
    assert.ok(selector && !selector.startsWith('a11y'), `real selector, got ${selector}`);
    assert.match(await bdg(['dom', 'query', selector]), /Found 1 node/);
    assert.equal(await clicksOnPage(), 'row1:Plain', 'the index reached the first row');
    await bdg(['dom', 'click', selector]);
    assert.equal(await clicksOnPage(), 'row1:Plain,row1:Plain', 'the selector reaches it again');
  });

  void it('starts at the nearest ancestor with an id, and finds the button again', async () => {
    const selector = await selectorAfterClick('InWrap');
    assert.match(selector ?? '', /^#wrap > button/);
    assert.equal(await clicksOnPage(), 'InWrap');
    const found = await bdg(['dom', 'query', selector ?? '']);
    assert.match(found, /Found 1 node/);
    assert.match(found, /InWrap/);
  });

  void it('finds an element in an open shadow root again', async () => {
    const selector = await selectorAfterClick('Shadowed');
    assert.ok(selector && !selector.startsWith('a11y'), `real selector, got ${selector}`);
    const found = await bdg(['dom', 'query', selector]);
    assert.match(found, /Found 1 node/);
    assert.match(found, /Shadowed/);
  });

  void it('is left out when no selector finds only that shadow root element', async () => {
    assert.equal(await selectorAfterClick('Ambiguous'), undefined);
  });

  void it('is left out for an element in a frame, never the cache key', async () => {
    assert.equal(await selectorAfterClick('Framed'), undefined);
  });

  void it('keeps the selector of a dom query index and of a selector target', async () => {
    await bdg(['dom', 'query', '#with-id']);
    assert.equal((await dataOf(['dom', 'click', '0']))['selector'], '#with-id');
    assert.equal((await dataOf(['dom', 'click', '#with-id']))['selector'], '#with-id');
  });
});
