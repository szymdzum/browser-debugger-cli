/**
 * `network details` timing phases smoke test (#837).
 *
 * A local server (`timingServer.ts`) answers `/wait` after a delay, trickles
 * the body of `/download`, and holds the first 6 of 8 parallel `/hold`
 * requests so the last two queue in Chrome. Each request's details must name
 * the dominant phase (`wait`, `download`, `queued`), in human output and in
 * `--json` `data.timingBreakdown`, and carry `item.protocol`. Only the
 * dominant phase is asserted, never exact times.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { startTimingServer, type TimingServer } from '@/__testutils__/timingServer.js';

interface Details {
  data: {
    item: { requestId: string; url: string; protocol?: string };
    timingBreakdown?: {
      phases?: Record<string, number>;
      dominant?: string;
      totalMs?: number;
      unavailable?: string;
    };
  };
}

let server: TimingServer;

/** Wait until the page has read every response (its title becomes `done`). */
async function waitForDone(): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const title = await runCommand('eval', ['document.title', '--json'], { timeout: 30000 });
    if (title.stdout.includes('"done"')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the page did not finish its requests');
}

/**
 * Ids of the captured requests whose path is `route`.
 *
 * @param route - Path
 * @returns Request ids
 */
async function idsOf(route: string): Promise<string[]> {
  const result = await runCommand('network', ['list', '--last', '0', '--json'], {
    timeout: 30000,
  });
  const { requests } = (
    JSON.parse(result.stdout) as { data: { requests: Array<{ requestId: string; url: string }> } }
  ).data;
  return requests.filter((r) => new URL(r.url).pathname === route).map((r) => r.requestId);
}

/**
 * `network details <id> --json`.
 *
 * @param id - Request id
 * @returns Parsed output
 */
async function detailsJson(id: string): Promise<Details> {
  const result = await runCommand('network', ['details', id, '--no-body', '--json'], {
    timeout: 30000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout) as Details;
}

before(async () => {
  await cleanupAllSessions();
  server = await startTimingServer();
  const port = await getFreePort();
  const result = await runCommand(server.url, ['--port', String(port), '--headless'], {
    timeout: 60000,
  });
  assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  await waitForDone();
});

after(async () => {
  await cleanupAllSessions();
  await server.close();
});

void describe('network details timing', () => {
  void it('names wait for a slow server, in --json and in text', async () => {
    const [id] = await idsOf('/wait');
    assert.ok(id, 'no /wait request');
    const { data } = await detailsJson(id);
    assert.equal(data.timingBreakdown?.dominant, 'wait', JSON.stringify(data.timingBreakdown));
    assert.equal(data.item.protocol, 'http/1.1');
    const text = await runCommand('network', ['details', id, '--no-body'], { timeout: 30000 });
    assert.match(text.stdout, /Timing\s+.*wait \d+ ms/);
    assert.match(text.stdout, /server time \(TTFB\)/);
  });

  void it('names download for a body that trickles in', async () => {
    const [id] = await idsOf('/download');
    assert.ok(id, 'no /download request');
    const { data } = await detailsJson(id);
    assert.equal(data.timingBreakdown?.dominant, 'download', JSON.stringify(data.timingBreakdown));
  });

  void it('names queued, with the 6-connection explanation, for requests behind 6 held ones', async () => {
    const ids = await idsOf('/hold');
    assert.equal(ids.length, 8);
    const queued: string[] = [];
    for (const id of ids) {
      const { data } = await detailsJson(id);
      if (data.timingBreakdown?.dominant === 'queued') queued.push(id);
    }
    assert.ok(queued.length >= 1 && queued.length <= 2, `queued: ${queued.length} of 8`);
    const text = await runCommand('network', ['details', queued[0] ?? '', '--no-body'], {
      timeout: 30000,
    });
    assert.match(text.stdout, /Chrome opens at most 6 connections per host/);
  });
});
