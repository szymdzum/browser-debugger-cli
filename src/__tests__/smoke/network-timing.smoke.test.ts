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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

interface HarEntry {
  time: number;
  request: { url: string };
  timings: { blocked: number };
}

void describe('network details timing', () => {
  void it('names wait for a slow server, in --json and in text', async () => {
    const [id] = await idsOf('/wait');
    assert.ok(id, 'no /wait request');
    const { data } = await detailsJson(id);
    assert.equal(data.timingBreakdown?.dominant, 'wait', JSON.stringify(data.timingBreakdown));
    assert.equal(data.item.protocol, 'http/1.1');
    const text = await runCommand('network', ['details', id, '--no-body'], { timeout: 30000 });
    assert.match(text.stdout, /Timing:\s+.*wait \d+ ms/);
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
    const seen: string[] = [];
    for (const id of ids) {
      const { data } = await detailsJson(id);
      seen.push(JSON.stringify(data.timingBreakdown));
      if (data.timingBreakdown?.dominant === 'queued') queued.push(id);
    }
    assert.ok(
      queued.length >= 1 && queued.length <= 2,
      `queued ${queued.length} of 8:\n${seen.join('\n')}`
    );
    const text = await runCommand('network', ['details', queued[0] ?? '', '--no-body'], {
      timeout: 30000,
    });
    assert.match(text.stdout, /Chrome opens at most 6 connections per host/);
  });

  void it('says a fetch aborted mid-body was cancelled', async () => {
    const [id] = await idsOf('/trickle');
    assert.ok(id, 'no /trickle request');
    const text = await runCommand('network', ['details', id, '--no-body'], { timeout: 30000 });
    assert.match(text.stdout, /Cancelled after \d+ ms \(net::ERR_ABORTED\); up to then/);
  });

  void it('exports the queue as HAR blocked, with time matching details (#847)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-har-'));
    try {
      const file = path.join(dir, 'out.har');
      const exported = await runCommand('network', ['har', file], { timeout: 30000 });
      assert.equal(exported.exitCode, 0, exported.stderr);
      const entries = (
        JSON.parse(fs.readFileSync(file, 'utf8')) as { log: { entries: HarEntry[] } }
      ).log.entries;
      const seen: string[] = [];
      let checked = 0;
      for (const id of await idsOf('/hold')) {
        const { data } = await detailsJson(id);
        const queued = data.timingBreakdown?.phases?.['queued'] ?? 0;
        if (queued <= 0 || data.timingBreakdown?.dominant !== 'queued') continue;
        const entry = entries.find((e) => e.request.url === data.item.url);
        assert.ok(entry, `no HAR entry for ${data.item.url}`);
        seen.push(
          `${JSON.stringify(entry.timings)} time ${entry.time} vs ${JSON.stringify(data.timingBreakdown)}`
        );
        assert.ok(entry.timings.blocked > 0, seen.join('\n'));
        assert.ok(
          Math.abs(entry.time - (data.timingBreakdown?.totalMs ?? NaN)) <= 2,
          seen.join('\n')
        );
        checked++;
      }
      assert.ok(checked >= 1, 'no queued /hold request');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
