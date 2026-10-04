/**
 * Console sources smoke test.
 *
 * Messages logged in a cross-origin iframe and in a worker, and browser
 * messages such as failed resource loads, must reach `bdg console` once each.
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

interface ListedMessage {
  type: string;
  text: string;
  source?: string;
  stackTrace?: Array<{ url: string }>;
}

/** Messages the `/frames` fixture produces */
const EXPECTED_MESSAGES = 3;

/**
 * List console messages, waiting until the fixture's messages have arrived.
 *
 * @returns Messages of the current page
 */
async function listMessages(): Promise<ListedMessage[]> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const result = await runCommand('console', ['--list', '--json'], { timeout: 30000 });
    assert.equal(result.exitCode, 0, result.stderr);
    const { messages } = (JSON.parse(result.stdout) as { data: { messages: ListedMessage[] } })
      .data;
    if (messages.length >= EXPECTED_MESSAGES || Date.now() > deadline) return messages;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

void describe('Console sources', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}frames`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('captures cross-origin iframe, worker and browser messages once each', async () => {
    const messages = await listMessages();
    const summary = messages.map((m) => [m.type, m.text, m.source]).sort();

    assert.deepEqual(summary, [
      [
        'error',
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
        'network',
      ],
      ['log', '"from cross-origin frame" {nested: {deep: {value: 42}}}', undefined],
      ['warning', 'from worker', undefined],
    ]);
    const frame = messages.find((m) => m.type === 'log');
    assert.match(frame?.stackTrace?.[0]?.url ?? '', /^http:\/\/localhost:\d+\/frame-child$/);
  });
});
