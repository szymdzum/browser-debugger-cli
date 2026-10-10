/**
 * Element class lists smoke test (#573).
 *
 * `classes` is always an array in JSON, `[]` for an element without classes:
 * in `dom query` nodes, in `dom get`'s `domContext` and in `dom get --raw`
 * nodes. Human output shows no class for such an element, as before.
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
 * @returns Stdout
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * The `data` of a command's JSON envelope.
 *
 * @param args - bdg arguments, without `--json`
 * @returns The envelope's data
 */
async function data(args: string[]): Promise<Record<string, unknown>> {
  return (JSON.parse(await bdg([...args, '--json'])) as { data: Record<string, unknown> }).data;
}

/**
 * The `classes` each command reports for the first element a selector matches.
 *
 * @param selector - CSS selector
 * @returns `classes` of `dom query`, `dom get` (`domContext`) and `dom get --raw`
 */
async function classesOf(selector: string): Promise<Record<string, unknown>> {
  const query = (await data(['dom', 'query', selector])) as { nodes: Array<{ classes?: unknown }> };
  const get = (await data(['dom', 'get', selector])) as { domContext?: { classes?: unknown } };
  const raw = (await data(['dom', 'get', selector, '--raw'])) as {
    nodes: Array<{ classes?: unknown }>;
  };
  return {
    query: query.nodes[0]?.classes,
    get: get.domContext?.classes,
    raw: raw.nodes[0]?.classes,
  };
}

void describe('Element class lists', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}shadow-forms`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports classes: [] for a shadow root input without classes (#573)', async () => {
    assert.deepEqual(await classesOf('#pin'), { query: [], get: [], raw: [] });
  });

  void it('reports [] for no, empty and blank class attributes, and every class otherwise', async () => {
    await bdg(['page', 'navigate', `${fixture.url}classes`]);
    for (const selector of ['#plain', '#empty', '#blank']) {
      assert.deepEqual(
        await classesOf(selector),
        { query: [], get: [], raw: [] },
        `classes of ${selector}`
      );
    }
    const styled = ['primary', 'large'];
    assert.deepEqual(await classesOf('#styled'), { query: styled, get: styled, raw: styled });
  });

  void it('shows no class for an element without classes in human output', async () => {
    await bdg(['page', 'navigate', `${fixture.url}classes`]);
    const query = await bdg(['dom', 'query', 'input, p, button']);
    assert.match(query, /\[0\] <input id="plain" name="plain" type="text">\n/);
    assert.match(query, /\[1\] <p id="empty"> Empty class\n/);
    assert.match(query, /\[2\] <p id="blank"> Blank class\n/);
    assert.match(query, /\[3\] <button id="styled" class="primary \+1"> Save\n/);
    assert.doesNotMatch(await bdg(['dom', 'get', '#plain']), /Classes/);
  });
});
