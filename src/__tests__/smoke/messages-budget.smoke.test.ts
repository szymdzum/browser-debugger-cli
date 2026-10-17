/**
 * Message snapshot time budget smoke test (#529).
 *
 * The snapshot of an action's new messages stops looking after a few
 * milliseconds. When that happens right after an outer container was kept,
 * the container must not be reported in place of the message inside it that
 * was never examined.
 *
 * Timing: the page makes the snapshot outlast the budget by itself (thousands
 * of hidden nodes: their text, or the search for the candidates), so the budget
 * runs out in the same place on any machine.
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
 */
async function open(url: string): Promise<void> {
  await cleanupAllSessions();
  const port = await getFreePort();
  const started = await runCommand(url, ['--port', String(port), '--headless'], {
    timeout: 60000,
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

  for (const [route, title] of [
    ['messages-budget', 'reports the inner message, not the container kept before it was examined'],
    [
      'messages-budget-empty',
      'reports the inner message when the budget ran out before any was kept',
    ],
  ] as const) {
    void it(title, async () => {
      await open(`${fixture.url}${route}`);
      const result = await runCommand('dom', ['click', '#show', '--json'], { timeout: 60000 });
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const data = (JSON.parse(result.stdout) as { data: { messages?: unknown } }).data;
      assert.deepEqual(data.messages, INNER_MESSAGE);
    });
  }
});
