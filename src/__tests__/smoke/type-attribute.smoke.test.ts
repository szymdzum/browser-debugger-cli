/**
 * Type attribute smoke test (#688).
 *
 * `dom query` and `dom get` show an element's `type` only when the page
 * sets it, as written: an implicit type (a field without `type` is text, a
 * button in a form submits) is not shown as an attribute, so a selector
 * built from the shown attributes matches the element. `--json` keeps the
 * live type.
 *
 * Timing: no waits; every command answers at once.
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

/** Each element, the `type` its tag may show (undefined: none) and its live type in JSON */
const MATRIX: Array<{
  id: string;
  tag: string;
  shown: string | undefined;
  live: string | undefined;
}> = [
  { id: 'plain', tag: 'input', shown: undefined, live: 'text' },
  { id: 'upper', tag: 'input', shown: 'EMAIL', live: 'email' },
  { id: 'plain-button', tag: 'button', shown: 'button', live: 'button' },
  { id: 'implicit-submit', tag: 'button', shown: undefined, live: 'submit' },
  { id: 'loose', tag: 'button', shown: undefined, live: undefined },
];

/**
 * Run a bdg dom command.
 *
 * @param args - Arguments after `dom`
 * @returns Output (stdout and stderr)
 */
async function dom(args: string[]): Promise<string> {
  const result = await runCommand('dom', args, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `dom ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

void describe('The type shown for an element', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}type-attribute`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const { id, tag, shown, live } of MATRIX) {
    const expected = shown === undefined ? 'no type' : `type="${shown}"`;
    void it(`#${id}: ${expected} in dom query and dom get, a selector from it matches`, async () => {
      const wanted = shown === undefined ? /^(?!.*\btype=)/ : new RegExp(`\\btype="${shown}"`);
      const query = await dom(['query', `#${id}`]);
      const line = query.split('\n').find((row) => row.includes(`id="${id}"`)) ?? '';
      assert.match(line, wanted, query);
      assert.match(await dom(['get', `#${id}`]), wanted);
      if (shown !== undefined) {
        assert.match(await dom(['query', `${tag}[type="${shown}"]`]), new RegExp(`id="${id}"`));
      }
      const json = JSON.parse(await dom(['query', `#${id}`, '--json'])) as {
        data: { nodes: Array<{ attributes?: { type?: string } }> };
      };
      assert.equal(json.data.nodes[0]?.attributes?.type, live);
    });
  }
});
