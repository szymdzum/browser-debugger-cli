/**
 * Domain filter with a port smoke test (#635).
 *
 * The session loads a page from the fixture server (127.0.0.1:<port>).
 * `domain:127.0.0.1:<port>` matches its requests, another port matches none,
 * and a port that is not a number is an invalid filter (exit 81).
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
import { removeTempDirs } from '@/__testutils__/tempDirs.js';

/**
 * Count the requests `network list` shows for a filter.
 *
 * @param filter - `--filter` DSL
 * @returns Exit code and the number of requests in `--json`
 */
async function countMatching(filter: string): Promise<{ exitCode: number; count: number }> {
  const result = await runCommand(
    'network',
    ['list', '--last', '0', '--filter', filter, '--json'],
    { timeout: 30000 }
  );
  if (result.exitCode !== 0) return { exitCode: result.exitCode, count: 0 };
  const data = (JSON.parse(result.stdout) as { data: { requests: unknown[] } }).data;
  return { exitCode: 0, count: data.requests.length };
}

after(removeTempDirs);

void describe('network filter domain:<host>:<port>', () => {
  let fixture: FixtureServer;
  let fixturePort: string;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    fixturePort = new URL(fixture.url).port;
    const port = await getFreePort();
    const result = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('matches the requests to that host and port', async () => {
    const withoutPort = await countMatching('domain:127.0.0.1');
    assert.ok(withoutPort.count > 0, 'the page made requests');
    const withPort = await countMatching(`domain:127.0.0.1:${fixturePort}`);
    assert.equal(withPort.count, withoutPort.count);
  });

  void it('matches nothing on another port', async () => {
    const other = await countMatching(`domain:127.0.0.1:${Number(fixturePort) + 1}`);
    assert.deepEqual(other, { exitCode: 0, count: 0 });
  });

  void it('rejects a port that is not a number', async () => {
    const bad = await countMatching('domain:127.0.0.1:abc');
    assert.equal(bad.exitCode, 81);
  });
});
