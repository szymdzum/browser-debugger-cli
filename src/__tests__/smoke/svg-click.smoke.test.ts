/**
 * SVG click smoke test (#692).
 *
 * A zero-size `<g role=button>` has no `click()` method and no box for the
 * mouse, so `dom click` (and `--double`) dispatch the events themselves (method
 * `dom`) and the page's listener sees them. A fallback script that throws is
 * reported as a script failure (91), never as "removed" (83/87).
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
 * The events the fixture's listener recorded.
 *
 * @returns Entries like `click:c25x:MouseEvent`
 */
async function recordedEvents(): Promise<string[]> {
  const output = await bdg(['dom', 'eval', 'JSON.stringify(window.__events)', '--json']);
  const data = (JSON.parse(output) as { data: { result: string } }).data.result;
  return JSON.parse(data) as string[];
}

void describe('Clicking SVG elements without a box', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}svg-click`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('clicks by selector through the DOM fallback', async () => {
    const output = await bdg(['dom', 'click', 'g[role=button][aria-label=c25x]', '--json']);
    const data = (JSON.parse(output) as { data: { method: string } }).data;
    assert.equal(data.method, 'dom');
    assert.deepEqual(await recordedEvents(), ['click:c25x:MouseEvent']);
  });

  void it('clicks by a11y index', async () => {
    await bdg(['dom', 'a11y', 'query', 'role=button name=c25x']);
    await bdg(['dom', 'click', '0']);
    assert.deepEqual((await recordedEvents()).slice(1), ['click:c25x:MouseEvent']);
  });

  void it('double-clicks with two clicks and a dblclick', async () => {
    await bdg(['dom', 'click', 'g[aria-label=other]', '--double']);
    assert.deepEqual((await recordedEvents()).slice(2), [
      'click:other:MouseEvent',
      'click:other:MouseEvent',
      'dblclick:other:MouseEvent',
    ]);
  });

  void it('reports a throwing fallback as a script failure, not as removed', async () => {
    await bdg([
      'dom',
      'eval',
      'document.querySelector("g[aria-label=other]").dispatchEvent = () => { throw new Error("boom"); }; 1',
    ]);
    const text = await bdg(['dom', 'click', 'g[aria-label=other]'], 91);
    assert.match(text, /boom/);
    assert.match(text, /The page's own code threw during the click/);
    assert.doesNotMatch(text, /removed|no longer in the page/);
  });
});
