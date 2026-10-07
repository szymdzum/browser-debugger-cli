/**
 * Smoke test for pages that replace built-ins bdg's scripts use: bdg's
 * own scripts run in its isolated world and still find and describe the
 * right elements, actions find their element there too and warn, and
 * `dom eval` keeps running in the page's world. Actions avoid the built-ins
 * pages commonly replace, a script that still breaks says which built-ins
 * the page replaced and what they threw, and `dom eval` results are copied
 * without the page's `Object.keys`.
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

void describe('page that replaces built-ins', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}tampered`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('finds and describes the right elements, also in same-origin frames', async () => {
    const query = await bdg(['dom', 'query', '.target']);
    assert.match(query, /Found 2 nodes matching "\.target":/);
    assert.match(query, /\[0\] <h1 class="target"> Heading/);
    assert.match(query, /\[1\] <p class="target"> \(in iframe\) In frame/);
    assert.match(await bdg(['dom', 'inspect', 'h1', '--tree', '0']), /^h1\.target "Heading"/);
    assert.match(await bdg(['dom', 'layout', '#go']), /\[0\] button#go "Go"/);
    assert.match(await bdg(['dom', 'get', 'h1']), /"Heading"/);
  });

  void it('clicks the element the selector names, and says the page replaced built-ins', async () => {
    const click = await bdg(['dom', 'click', '#go']);
    assert.match(click, /Element: +button#go "Go"/);
    assert.match(
      click,
      /the page replaced built-ins bdg's scripts use \(Element\.prototype\.querySelectorAll/
    );
    assert.match(
      await bdg(['dom', 'eval', 'document.getElementById("go").textContent']),
      /Clicked/
    );
  });

  void it('keeps dom eval in the page world', async () => {
    assert.match(await bdg(['dom', 'eval', 'JSON.stringify({ a: 1 })']), /replaced/);
  });
});

void describe('page whose replaced built-ins break action scripts', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}tampered-actions`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('fills and clicks although matches() matches everything and Event is replaced', async () => {
    const fill = await bdg(['dom', 'fill', '#name', 'Alice']);
    assert.match(fill, /Value: +Alice/);
    assert.match(fill, /Element\.prototype\.matches/);
    assert.match(
      await bdg(['dom', 'eval', 'document.getElementById("log").textContent']),
      /input;change;/
    );
    await bdg(['dom', 'click', '#go']);
    assert.match(
      await bdg(['dom', 'eval', 'document.getElementById("go").textContent']),
      /Clicked/
    );
  });

  void it('names the replaced built-ins and the error when a page API throws', async () => {
    assert.match(
      await bdg(['dom', 'fill', '#guarded-field', 'x'], 90),
      /The page replaced built-ins bdg's fill script uses \(.*EventTarget\.prototype\.dispatchEvent.*\), and the script failed: Error: anti-bot: dispatchEvent/
    );
    assert.match(
      await bdg(['dom', 'click', '#guarded'], 90),
      /The page replaced built-ins bdg's click script uses \(.*Element\.prototype\.getBoundingClientRect.*\), and the script failed: Error: anti-bot: getBoundingClientRect/
    );
  });

  void it("copies eval results without the page's Object.keys", async () => {
    const result = await runCommand('dom', ['eval', '--json', '({ a: 1, b: [1, 2] })'], {
      timeout: 60000,
    });
    const response = JSON.parse(result.stdout) as { data: { result: unknown; warning?: string } };
    assert.deepEqual(response.data.result, { a: 1, b: [1, 2] });
    assert.match(response.data.warning ?? '', /the page replaced Object\.keys/);
  });
});
