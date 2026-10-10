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
 * They arrive within about 1 s of the start; the wait allows 10 s.
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

/**
 * The page URL `bdg status` reports, read until it matches (or 10 s passed).
 *
 * @param expected - URL the page is going to
 * @returns The last URL reported
 */
async function statusUrlOnceChanged(expected: RegExp): Promise<string> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const status = await runCommand('status', ['--json'], { timeout: 30000 });
    const data = (JSON.parse(status.stdout) as { data: { pageState?: { url: string } } }).data;
    const url = data.pageState?.url ?? '';
    if (expected.test(url) || Date.now() > deadline) return url;
    await new Promise((resolve) => setTimeout(resolve, 100));
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
      ['log', 'from cross-origin frame {nested: {deep: {value: 42}}}', undefined],
      ['warning', 'from worker', undefined],
    ]);
    const frame = messages.find((m) => m.type === 'log');
    assert.match(frame?.stackTrace?.[0]?.url ?? '', /^http:\/\/localhost:\d+\/frame-child$/);
  });

  void it('records the network traffic of cross-origin iframes to completion', async () => {
    const result = await runCommand('network', ['list', '--last', '0', '--json'], {
      timeout: 30000,
    });
    const { requests } = (
      JSON.parse(result.stdout) as {
        data: { requests: Array<{ url: string; status?: number; duration?: number }> };
      }
    ).data;
    const frameDocument = requests.find((r) => /^http:\/\/localhost:\d+\/frame-child$/.test(r.url));

    assert.equal(frameDocument?.status, 200);
    assert.equal(typeof frameDocument?.duration, 'number', 'finished, not left pending');
  });

  void it('follows same-document navigations in status', async () => {
    await runCommand('dom', ['eval', 'history.pushState({}, "", "/pushed"); 1'], {
      timeout: 30000,
    });

    assert.match(await statusUrlOnceChanged(/\/pushed$/), /\/pushed$/);
  });

  void it("marks the previous page's messages in peek after a navigation (#554)", async () => {
    await listMessages();
    const navigated = await runCommand('page', ['navigate', `${fixture.url}issues/clean`], {
      timeout: 60000,
    });
    assert.equal(navigated.exitCode, 0, navigated.stderr);

    const peek = await runCommand('peek', ['--console', '--last', '0'], { timeout: 30000 });
    assert.match(peek.stdout, /^ {2}ERROR (\(previous page\)) Failed to load resource: .*404/m);
    const json = await runCommand('peek', ['--last', '0', '--json'], { timeout: 30000 });
    const data = (
      JSON.parse(json.stdout) as {
        data: {
          currentNavigationId: number;
          console: Array<{ text: string; previousPage?: boolean; navigationId?: number }>;
          network: Array<{ url: string; previousPage?: boolean }>;
        };
      }
    ).data;
    const failed = data.console.find((m) => m.text.startsWith('Failed to load resource'));
    assert.equal(failed?.previousPage, true);
    assert.ok((failed?.navigationId ?? Infinity) < data.currentNavigationId);
    const current = data.network.find((r) => r.url.endsWith('/issues/clean'));
    assert.equal(current?.previousPage, undefined, "the current page's document is not marked");
  });
});
