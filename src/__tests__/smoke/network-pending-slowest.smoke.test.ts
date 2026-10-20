/**
 * `network list --sort duration` and `--preset slow` with a request still
 * pending (#861).
 *
 * A local server (`timingServer.ts`) serves `/pending`, which fetches three
 * quick assets and `/never`, an endpoint that never answers. Once the page
 * has read the quick ones, the pending request must be listed by its elapsed
 * time, marked pending, in human output and in `--json` (`pending: true`,
 * `elapsedMs`; `duration` stays absent). `--preset slow` includes it once it
 * has been pending for a second. Only the order and the marks are asserted,
 * never exact times.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { startTimingServer, type TimingServer } from '@/__testutils__/timingServer.js';

interface ListedRequest {
  url: string;
  duration?: number;
  pending?: boolean;
  elapsedMs?: number;
}

interface ListJson {
  data: { requests: ListedRequest[]; filteredCount: number };
}

const SLOW_MS = 1000;
const DEADLINE_MS = 20000;

let server: TimingServer;

/**
 * `network list <args> --json`.
 *
 * @param args - Arguments after `list`
 * @returns The listed requests and the filtered count
 */
async function listJson(...args: string[]): Promise<ListJson['data']> {
  const result = await runCommand('network', ['list', ...args, '--json'], { timeout: 30000 });
  assert.equal(result.exitCode, 0, result.stderr);
  return (JSON.parse(result.stdout) as ListJson).data;
}

/**
 * Wait until the page has read its quick assets (its title becomes `fast-done`).
 */
async function waitForFastAssets(): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const title = await runCommand('eval', ['document.title', '--json'], { timeout: 30000 });
    if (title.stdout.includes('"fast-done"')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the page did not read its quick assets');
}

/**
 * Wait until the pending request has been pending for the slow preset's threshold.
 */
async function waitForSlowPending(): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const { requests } = await listJson('--preset', 'slow');
    if (requests.some((r) => r.url.endsWith('/never'))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

before(async () => {
  await cleanupAllSessions();
  server = await startTimingServer();
  const port = await getFreePort();
  const result = await runCommand(`${server.url}pending`, ['--port', String(port), '--headless'], {
    timeout: 60000,
  });
  assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  await waitForFastAssets();
  await waitForSlowPending();
});

after(async () => {
  await cleanupAllSessions();
  await server.close();
});

void describe('network list with a request that never answers (#861)', () => {
  void it('--sort duration --last 2 lists it first, with elapsed time and no duration', async () => {
    const { requests } = await listJson('--sort', 'duration', '--last', '2');
    const [first, second] = requests;
    assert.ok(first && second, JSON.stringify(requests));
    assert.ok(first.url.endsWith('/never'), JSON.stringify(requests));
    assert.equal(first.pending, true);
    assert.ok((first.elapsedMs ?? 0) >= SLOW_MS, JSON.stringify(first));
    assert.equal(first.duration, undefined);
    assert.equal(second.pending, undefined);
    assert.ok((second.duration ?? Infinity) < (first.elapsedMs ?? 0), JSON.stringify(requests));
  });

  void it('--sort duration marks it in the row and keeps the header true', async () => {
    const result = await runCommand('network', ['list', '--sort', 'duration', '--last', '2'], {
      timeout: 30000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /NETWORK REQUESTS \(2 slowest of \d+\)/);
    const row = result.stdout.split('\n').find((line) => line.includes('/never')) ?? '';
    assert.match(row, /PND .*≥\d+\.\ds {2}/, result.stdout);
    assert.equal(result.stdout.split('\n').findIndex((line) => line.includes('/never')), 4);
  });

  void it('--preset slow includes it, marked pending', async () => {
    const { requests, filteredCount } = await listJson('--preset', 'slow');
    const never = requests.filter((r) => r.url.endsWith('/never'));
    assert.equal(never.length, 1, JSON.stringify(requests));
    assert.equal(never[0]?.pending, true);
    assert.ok((never[0]?.elapsedMs ?? 0) >= SLOW_MS);
    assert.equal(filteredCount, requests.length);
    const text = await runCommand('network', ['list', '--preset', 'slow'], { timeout: 30000 });
    assert.match(text.stdout, /PND .*≥\d+\.\ds .*\/never/, text.stdout);
  });

  void it('leaves it unmarked when neither option is used', async () => {
    const { requests } = await listJson();
    const never = requests.find((r) => r.url.endsWith('/never'));
    assert.ok(never, 'no /never request');
    assert.equal(never.pending, undefined);
    assert.equal(never.elapsedMs, undefined);
  });
});
