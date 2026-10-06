/**
 * Smoke test for a page whose renderer crashes mid-session: the session
 * says so, page commands fail at once with 107, and a reload brings the page
 * back.
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

void describe('page crash', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}inspect`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports a crashed page, fails page commands at once, and recovers on reload', async () => {
    await bdg(['cdp', 'Page.crash'], 107);
    assert.match(
      await bdg(['status']),
      /\n⚠ The page crashed at .+ \(renderer gone\); bdg page reload brings it back\n/
    );
    assert.match(await bdg(['peek']), /^⚠ The page crashed at /);
    const started = Date.now();
    assert.match(
      await bdg(['dom', 'query', 'h1'], 107),
      /The page crashed at .+ \(its renderer is gone\), so page commands cannot run\n.*bdg page reload/
    );
    assert.ok(Date.now() - started < 10000, 'fails at once instead of waiting for the page');
    const json = JSON.parse(await bdg(['status', '--json'])) as {
      data: { pageState: { crashedAt?: number } };
    };
    assert.equal(typeof json.data.pageState.crashedAt, 'number');

    await bdg(['page', 'reload']);
    assert.doesNotMatch(await bdg(['status']), /crashed/);
    assert.match(await bdg(['dom', 'query', 'body']), /Found \d+ nodes? matching "body"/);
  });
});
