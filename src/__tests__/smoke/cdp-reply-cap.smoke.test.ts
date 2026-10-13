/**
 * A `bdg cdp` reply Chrome cannot send (over about 256 MiB) ends in a clear
 * error naming the limit (exit 81), not a 30 s timeout (#712).
 *
 * The 250e6 case that must print (exit 0) is measured by hand: it needs
 * several GB of memory, too heavy for CI.
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

void describe('cdp reply size cap', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const start = await runCommand(
      `${fixture.url}interactions`,
      ['--port', String(await getFreePort()), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(start.exitCode, 0, start.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('a 300e6 string exits 81 with the limit and a hint, before the 30 s timeout', async () => {
    const startedAt = Date.now();
    const result = await runCommand(
      'cdp',
      ['Runtime.evaluate', '--params', JSON.stringify({ expression: `'x'.repeat(300e6)` })],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 81, result.stderr.slice(0, 300));
    assert.match(result.stderr, /256 MiB/);
    assert.match(result.stderr, /returnByValue/);
    assert.ok(Date.now() - startedAt < 28_000, `${Date.now() - startedAt} ms`);
  });
});
