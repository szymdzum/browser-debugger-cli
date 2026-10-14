/**
 * Repeated requests smoke test (#670).
 *
 * A `dom click` on `/repeated-requests` fires 8 `POST /event?s=N` beacons and
 * 2 other requests. Human output lists the beacons as one row
 * (`POST 127.0.0.1:N/event ×8 → 200`) between the two single rows, with the
 * title still counting all 10 requests; `--json` `triggeredRequests` keeps
 * all 10 with their query strings.
 *
 * Waits are the click's own network wait; nothing sleeps.
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
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}repeated-requests`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom click that fires repeated requests', () => {
  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}repeated-requests`]);
  });

  void it('groups requests with the same method, host and path in human output', async () => {
    const output = await bdg(['dom', 'click', '#fire']);
    assert.match(output, /Requests during the action \(10\):\n/);
    assert.match(output, /\n {2}POST 127\.0\.0\.1:\d+\/event ×8 → 200\n/);
    assert.doesNotMatch(output, /event\?s=/);
    assert.match(output, /\n {2}GET 127\.0\.0\.1:\d+\/api\/test → 200/);
    assert.match(output, /\n {2}POST 127\.0\.0\.1:\d+\/api\/other → 200/);
  });

  void it('keeps every request in --json', async () => {
    const json = JSON.parse(await bdg(['dom', 'click', '#fire', '--json'])) as {
      data: { triggeredRequests: Array<{ url: string }> };
    };
    const urls = json.data.triggeredRequests.map((r) => r.url);
    assert.equal(urls.length, 10, urls.join('\n'));
    assert.equal(urls.filter((url) => /\/event\?s=\d$/.test(url)).length, 8);
  });
});
