/**
 * `url:` network filter smoke test (#652).
 *
 * The session starts on `/url-filter` through a URL with `user:pass@`; the
 * page fetches `/uf-api/v2/items?access_token=…`, `/uf-api/v1/ping?token=abcdef`
 * and `/uf-cdn/logo.png`. `url:` matches the URL as shown: masked by default
 * (the filter is no oracle for a masked token), raw with `--include-sensitive`;
 * `network har --filter url:` matches the URL as the HAR writes it.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  URL_FILTER_PATH,
  URL_FILTER_SECRET,
} from '@/__testutils__/fixturePages/urlFilterFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { removeTempDirs } from '@/__testutils__/tempDirs.js';

after(removeTempDirs);

/** Outcome of a command: exit code, shown URLs and the raw output */
interface Outcome {
  exitCode: number;
  urls: string[];
  output: string;
}

/**
 * Requests `network list --json` shows for a filter.
 *
 * @param filter - `--filter` DSL
 * @param extra - More arguments (e.g. `--include-sensitive`)
 * @returns Exit code, request URLs and the output
 */
async function listUrls(filter: string, extra: string[] = []): Promise<Outcome> {
  const result = await runCommand(
    'network',
    ['list', '--last', '0', '--filter', filter, '--json', ...extra],
    { timeout: 30000 }
  );
  const output = result.stdout + result.stderr;
  if (result.exitCode !== 0) return { exitCode: result.exitCode, urls: [], output };
  const data = (JSON.parse(result.stdout) as { data: { requests: Array<{ url: string }> } }).data;
  return { exitCode: 0, urls: data.requests.map((request) => request.url), output };
}

/**
 * Entries `network har --filter` writes.
 *
 * @param filter - `--filter` DSL
 * @param dir - Directory for the HAR file
 * @param extra - More arguments (e.g. `--include-sensitive`)
 * @returns Exit code, request URLs of the HAR and the output
 */
async function harUrls(filter: string, dir: string, extra: string[] = []): Promise<Outcome> {
  const file = path.join(dir, `f${Math.random().toString(36).slice(2)}.har`);
  const result = await runCommand('network', ['har', file, '--filter', filter, ...extra], {
    timeout: 30000,
  });
  const output = result.stdout + result.stderr;
  if (result.exitCode !== 0) return { exitCode: result.exitCode, urls: [], output };
  const har = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    log: { entries: Array<{ request: { url: string } }> };
  };
  return { exitCode: 0, urls: har.log.entries.map((entry) => entry.request.url), output };
}

/**
 * Wait until the fixture page has sent its requests (its title becomes `done`).
 */
async function waitForPage(): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const title = await runCommand('eval', ['document.title', '--json'], { timeout: 30000 });
    if (title.stdout.includes('"done"')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the fixture page did not finish');
}

void describe('network filter url:<text>', () => {
  let fixture: FixtureServer;
  let harDir: string;

  before(async () => {
    await cleanupAllSessions();
    harDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-652-har-'));
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const start = new URL(URL_FILTER_PATH, fixture.url);
    start.username = 'user';
    start.password = 'pw';
    const result = await runCommand(start.href, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await waitForPage();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
    fs.rmSync(harDir, { recursive: true, force: true });
  });

  void it('matches a substring of the URL, case-insensitively', async () => {
    for (const filter of ['url:access_token', 'url:ACCESS_TOKEN']) {
      const { exitCode, urls } = await listUrls(filter);
      assert.equal(exitCode, 0, filter);
      assert.equal(urls.length, 1, filter);
      assert.ok(urls[0]?.includes('/uf-api/v2/items'), filter);
    }
  });

  void it('treats * as in domain:, over the whole URL', async () => {
    const { urls } = await listUrls('url:*api*v2*');
    assert.equal(urls.length, 1);
    assert.equal((await listUrls('url:api*v2')).urls.length, 0, 'anchored at the start');
  });

  void it('negates with !url:', async () => {
    const { urls } = await listUrls('!url:uf-cdn');
    assert.ok(urls.length >= 2);
    assert.ok(urls.every((url) => !url.includes('uf-cdn')));
    assert.ok(urls.some((url) => url.includes('uf-api/v2')));
  });

  void it('does not match a masked value, matches the raw one with --include-sensitive', async () => {
    assert.equal((await listUrls('url:token=abc')).urls.length, 0);
    assert.equal((await listUrls(`url:${URL_FILTER_SECRET}`)).urls.length, 0);
    const raw = await listUrls('url:token=abc', ['--include-sensitive']);
    assert.equal(raw.urls.length, 1);
    const secret = await listUrls(`url:${URL_FILTER_SECRET}`, ['--include-sensitive']);
    assert.equal(secret.urls.length, 1);
  });

  void it('does not match the user info of the URL', async () => {
    assert.equal((await listUrls('url:user')).urls.length, 0);
    assert.equal((await listUrls('url:user', ['--include-sensitive'])).urls.length, 0);
    assert.equal((await listUrls('url:127.0.0.1')).urls.length >= 3, true);
  });

  void it('filters the HAR by the URL as the HAR writes it', async () => {
    assert.equal((await harUrls('url:access_token', harDir)).urls.length, 1);
    assert.equal((await harUrls('url:token=abc', harDir)).urls.length, 0);
    assert.equal((await harUrls(`url:${URL_FILTER_SECRET}`, harDir)).urls.length, 0);
    const raw = await harUrls('url:token=abc', harDir, ['--include-sensitive']);
    assert.equal(raw.urls.length, 1);
    assert.equal((await harUrls('url:user', harDir)).urls.length, 0);
    assert.equal((await harUrls('url:user', harDir, ['--include-sensitive'])).urls.length, 1);
  });

  void it('rejects an empty value', async () => {
    assert.equal((await listUrls('url:')).exitCode, 81);
    assert.equal((await harUrls('url:', harDir)).exitCode, 81);
  });

  void it('proposes url: for a word without a type', async () => {
    const list = await listUrls('access_token');
    assert.equal(list.exitCode, 81);
    assert.ok(list.output.includes('url:access_token'), list.output);
    const har = await harUrls('access_token', harDir);
    assert.equal(har.exitCode, 81);
    assert.ok(har.output.includes('url:access_token'), har.output);
  });

  void it('lists url among the valid types and keeps did-you-mean for url2:', async () => {
    const result = await listUrls('url2:x');
    assert.equal(result.exitCode, 81);
    assert.match(result.output, /Did you mean: url/);
  });

  /**
   * `network list` for a filter, human and `--json`.
   *
   * @param filter - `--filter` DSL
   * @param extra - More arguments
   * @returns Human output, and the `data` of the `--json` run
   */
  async function bothFormats(
    filter: string,
    extra: string[] = []
  ): Promise<{ human: string; data: { requests: unknown[]; filterHints?: string[] } }> {
    const args = ['list', '--last', '0', '--filter', filter, ...extra];
    const human = await runCommand('network', args, { timeout: 30000 });
    const json = await runCommand('network', [...args, '--json'], { timeout: 30000 });
    const data = (JSON.parse(json.stdout) as { data: { requests: unknown[] } }).data;
    return { human: human.stdout, data };
  }

  void it('hints that masked values match only with --include-sensitive', async () => {
    const { human, data } = await bothFormats('url:abcdef');
    assert.equal(data.requests.length, 0);
    assert.match(
      human,
      /No matching requests found\.\n.*masked values match only with --include-sensitive/
    );
    assert.equal(data.filterHints?.length, 1);
    const raw = await bothFormats('url:abcdef', ['--include-sensitive']);
    assert.equal(raw.data.requests.length, 1);
    assert.equal(raw.data.filterHints, undefined);
    const unmasked = await bothFormats('url:nothing-like-this', ['--include-sensitive']);
    assert.equal(unmasked.data.filterHints, undefined);
  });

  void it('hints that a pattern with * must match the whole URL', async () => {
    const { human, data } = await bothFormats('url:uf-*');
    assert.equal(data.requests.length, 0);
    assert.ok(human.includes("'url:*uf-*'"), human);
    assert.ok(data.filterHints?.some((hint) => hint.includes("'url:*uf-*'")));
    assert.equal((await bothFormats('url:*uf-*')).data.filterHints, undefined);
  });

  void it('names an unbalanced quote', async () => {
    const result = await listUrls('url:"v1');
    assert.equal(result.exitCode, 81);
    assert.match(result.output, /quote/i);
    assert.doesNotMatch(result.output, /Missing value/);
  });
});
