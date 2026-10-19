/**
 * `dom fill` into a field that restores its old value after the focus
 * (#866), smoke test.
 *
 * On `/fill-deferred-restore` the fields hold `0.00` and put it back in a
 * deferred `focus` or `focusin` handler, between the fill script emptying
 * the field and the text being typed. The typed text replaces what the field
 * holds, like a user's Ctrl+A and typing: the value is `8.00`, with no
 * `valueMismatch`. A field that restores nothing fills as before.
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

/** What the tests read of `dom fill --json` */
interface FillJson {
  value?: string;
  valueMismatch?: { expected: string; actual: string };
}

/**
 * Run a bdg command with `--json` and return its `data`.
 *
 * @param args - Full bdg argument list, without `--json`
 * @returns `data` of the response
 */
async function json<T>(args: string[]): Promise<T> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, [...rest, '--json'], { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return (JSON.parse(result.stdout) as { data: T }).data;
}

/**
 * Evaluate an expression in the page.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  return (await json<{ result: unknown }>(['eval', expression])).result;
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  const start = await runCommand(
    `${fixture.url}fill-deferred-restore`,
    ['--port', String(port), '--headless'],
    { timeout: 60000 }
  );
  assert.equal(start.exitCode, 0, `${start.stdout}${start.stderr}`);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom fill replaces a value the field restores after the focus (#866)', () => {
  for (const [id, how] of [
    ['t0', 'a focus handler restoring in setTimeout(0)'],
    ['ta', 'a textarea with a focus handler restoring in setTimeout(0)'],
    ['fin', 'a focusin handler restoring in setTimeout(0)'],
  ] as const) {
    void it(`leaves 8.00 in a field with ${how}`, async () => {
      await runCommand('page', ['navigate', `${fixture.url}fill-deferred-restore`]);
      const fill = await json<FillJson>(['dom', 'fill', `#${id}`, '8.00']);
      assert.equal(fill.valueMismatch, undefined, `no valueMismatch: ${JSON.stringify(fill)}`);
      assert.equal(await evaluate(`document.getElementById('${id}').value`), '8.00');
    });
  }

  void it('fills a field that restores nothing as before', async () => {
    await runCommand('page', ['navigate', `${fixture.url}fill-deferred-restore`]);
    const fill = await json<FillJson>(['dom', 'fill', '#plain', '8.00']);
    assert.equal(fill.valueMismatch, undefined);
    assert.equal(await evaluate("document.getElementById('plain').value"), '8.00');
  });
});
