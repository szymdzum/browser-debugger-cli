/**
 * Smoke test for the 1.0 names of DOM action `--json` fields (#844):
 * overflow counts are `moreTriggeredRequests` and `moreSubmitBlocked`, and
 * `dom submit` reports `elapsedMs` (as `dom wait`) without the
 * `navigationOccurred` boolean (`navigation` carries it). The old names are
 * gone. Pages: `actionFieldNamesFixtures.ts`.
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
 * Run a bdg command, assert exit 0 and return `data` of its `--json` output.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns The envelope's `data`
 */
async function bdgData(args: string[]): Promise<Record<string, unknown>> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, [...rest, '--json'], { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: Record<string, unknown> }).data;
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  const result = await runCommand(
    `${fixture.url}field-names`,
    ['--port', String(port), '--headless'],
    { timeout: 60000 }
  );
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('DOM action --json field names (#844)', () => {
  beforeEach(async () => {
    await bdgData(['page', 'navigate', `${fixture.url}field-names`]);
  });

  void it('counts requests past the first 50 as moreTriggeredRequests', async () => {
    const data = await bdgData(['dom', 'click', '#many-requests']);
    assert.equal(Array.isArray(data['triggeredRequests']), true, JSON.stringify(data));
    assert.equal(typeof data['moreTriggeredRequests'], 'number', JSON.stringify(data));
    assert.equal('triggeredRequestsOmitted' in data, false);
  });

  void it('counts blocked fields past the first 5 as moreSubmitBlocked', async () => {
    const data = await bdgData(['dom', 'click', '#blocked-submit']);
    assert.equal((data['submitBlocked'] as unknown[]).length, 5, JSON.stringify(data));
    assert.equal(data['moreSubmitBlocked'], 1, JSON.stringify(data));
    assert.equal('submitBlockedOmitted' in data, false);
  });

  void it('dom submit reports elapsedMs and navigation, not waitTimeMs or navigationOccurred', async () => {
    const data = await bdgData(['dom', 'submit', '#nav-form']);
    assert.equal(typeof data['elapsedMs'], 'number', JSON.stringify(data));
    assert.ok(data['navigation'], JSON.stringify(data));
    assert.equal('waitTimeMs' in data, false);
    assert.equal('navigationOccurred' in data, false);
  });
});
