/**
 * Message snapshot time budget smoke test (#529).
 *
 * The snapshot of an action's new messages stops looking after a few
 * milliseconds. When that happens right after an outer container was kept,
 * the container must not be reported in place of the message inside it that
 * was never examined.
 *
 * Timing: none. The budget is made to run out after a number of candidates
 * (`BDG_TEST_MESSAGES_BUDGET_CANDIDATES`, read by the daemon) instead of
 * milliseconds, so it runs out in the same place on any machine and the page
 * needs no costly tail (#853).
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
 * Start a session on a fixture page.
 *
 * @param url - Page URL
 * @param candidates - Candidates the message snapshot examines before its budget is spent
 */
async function open(url: string, candidates: string): Promise<void> {
  await cleanupAllSessions();
  const port = await getFreePort();
  const started = await runCommand(url, ['--port', String(port), '--headless'], {
    timeout: 60000,
    env: { BDG_TEST_MESSAGES_BUDGET_CANDIDATES: candidates },
  });
  assert.equal(started.exitCode, 0, started.stderr);
}

/** The message the click on `#show` has to report, with the element it sits in */
const INNER_MESSAGE = [
  { text: 'Your password is invalid!', element: 'div#inner-flash.flash.error' },
];

void describe('Message snapshot budget', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  for (const [candidates, title] of [
    ['1', 'reports the inner message, not the container kept before it was examined'],
    ['0', 'reports the inner message when the budget ran out before any was kept'],
  ] as const) {
    void it(title, async () => {
      await open(`${fixture.url}messages-budget`, candidates);
      const result = await runCommand('dom', ['click', '#show', '--json'], { timeout: 60000 });
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const data = (JSON.parse(result.stdout) as { data: { messages?: unknown } }).data;
      assert.deepEqual(data.messages, INNER_MESSAGE);
    });
  }
});
