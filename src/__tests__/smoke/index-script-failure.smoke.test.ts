/**
 * Index script failure smoke test (#630).
 *
 * When an action script throws in the page on an element given by an
 * `a11y query` index, the suggestion names the index (`bdg dom get 0`),
 * never the cache's internal `a11y ...` key; for a selector it still names
 * the quoted selector. Both exit 110, in text and in `--json`.
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

/** What the tests read of a failed `--json` response */
interface FailureJson {
  success: boolean;
  error: string;
  suggestion: string;
  exitCode: number;
}

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
 * Run `dom click --json` expecting the script failure and parse it.
 *
 * @param target - Selector or index
 * @returns The failure response
 */
async function failedClick(target: string): Promise<FailureJson> {
  const result = await runCommand('dom', ['click', target, '--json'], { timeout: 60000 });
  assert.equal(result.exitCode, 110, `bdg dom click ${target} --json: ${result.stdout}`);
  return JSON.parse(result.stdout) as FailureJson;
}

void describe('Action script failure on an index', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}index-script-failure`, '--port', String(port), '--headless']);
    await bdg(['dom', 'eval', "Math.round = function () { throw new Error('boom'); }; 1"]);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('names the a11y index, not the cache key, in text and JSON', async () => {
    await bdg(['dom', 'a11y', 'query', 'role=button']);
    const text = await bdg(['dom', 'click', '0'], 110);
    assert.match(text, /The click script failed in the page: Error: boom/);
    assert.match(text, /Check the element with bdg dom get 0, or/);
    assert.doesNotMatch(text, /a11y /);
    const json = await failedClick('0');
    assert.match(json.suggestion, /bdg dom get 0, or/);
    assert.doesNotMatch(json.suggestion, /a11y /);
  });

  void it('names the index of a dom query result', async () => {
    await bdg(['dom', 'query', 'button']);
    assert.match((await failedClick('0')).suggestion, /bdg dom get 0, or/);
  });

  void it('still names the quoted selector for a selector target', async () => {
    const text = await bdg(['dom', 'click', '#go'], 110);
    assert.match(text, /Check the element with bdg dom get "#go", or/);
    assert.match((await failedClick('#go')).suggestion, /bdg dom get "#go", or/);
  });
});
