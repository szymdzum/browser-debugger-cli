/**
 * Smoke test for a page that replaces built-ins bdg's scripts use: bdg's
 * own scripts run in its isolated world and still find and describe the
 * right elements, actions find their element there too and warn, and
 * `dom eval` keeps running in the page's world.
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
