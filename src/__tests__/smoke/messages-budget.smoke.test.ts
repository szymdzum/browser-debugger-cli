/**
 * Message snapshot time budget smoke test (#529).
 *
 * The snapshot of an action's new messages stops looking after a few
 * milliseconds. When that happens right after an outer container was kept,
 * the container must not be reported in place of the message inside it that
 * was never examined.
 *
 * Timing: the page makes reading the container's text outlast the budget by
 * itself (thousands of hidden text nodes), so the budget runs out in the same
 * place on any machine.
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

void describe('Message snapshot budget', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
    await cleanupAllSessions();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}messages-budget`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports the inner message, not the container kept before it was examined', async () => {
    const result = await runCommand('dom', ['click', '#show', '--json'], { timeout: 60000 });
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const data = (JSON.parse(result.stdout) as { data: { messages?: unknown } }).data;
    assert.deepEqual(data.messages, [
      { text: 'Your password is invalid!', element: 'div#inner-flash.flash.error' },
    ]);
  });
});
