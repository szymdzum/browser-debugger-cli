/**
 * Network and navigation smoke test against a real redirect.
 *
 * Starts a session on `/redirect` (302 to `/`) and checks that the redirect hop
 * is recorded, exported to HAR, and that console messages of the page load are
 * not dropped.
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/**
 * Run a bdg command with `--json` and return the parsed envelope's `data`.
 *
 * @param command - bdg subcommand
 * @param args - Additional arguments
 * @returns Parsed `data` field
 */
async function runJson<T>(command: string, args: string[] = []): Promise<T> {
  const result = await runCommand(command, [...args, '--json'], { timeout: 30000 });
  assert.equal(result.exitCode, 0, `bdg ${command} ${args.join(' ')} failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: T }).data;
}

interface ListedRequest {
  requestId: string;
  url: string;
  status?: number;
}

void describe('Network and navigation', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(
      `${fixture.url}redirect`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('records the redirect hop and the final document', async () => {
    const data = await runJson<{ requests: ListedRequest[] }>('network', ['list', '--last', '0']);
    const hop = data.requests.find((r) => r.url.endsWith('/redirect'));
    const final = data.requests.find((r) => r.url === fixture.url && r.status === 200);
    assert.equal(hop?.status, 302, `Requests: ${JSON.stringify(data.requests)}`);
    assert.match(hop?.requestId ?? '', /:redirect:1$/);
    assert.ok(final, 'final document request should be recorded');
  });

  void it('exports the redirect target to HAR', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-har-')), 'out.har');
    const result = await runCommand('network', ['har', file], { timeout: 30000 });
    assert.equal(result.exitCode, 0, `HAR failed: ${result.stderr}`);
    const har = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      log: {
        entries: Array<{
          request: { url: string };
          response: { status: number; redirectURL: string };
        }>;
      };
    };
    const hop = har.log.entries.find((e) => e.request.url.endsWith('/redirect'));
    assert.equal(hop?.response.status, 302);
    assert.equal(hop?.response.redirectURL, fixture.url);
  });

  void it('keeps all console messages of the current page load', async () => {
    const data = await runJson<{ messages: Array<{ text: string }> }>('console', ['--list']);
    const texts = data.messages.map((m) => m.text);
    assert.ok(texts.includes('Test page loaded successfully'), `Console: ${texts.join(' | ')}`);
    assert.ok(texts.includes('This is a test warning'), `Console: ${texts.join(' | ')}`);
  });

  void it('serves headers of the main document by default', async () => {
    const data = await runJson<{ url: string }>('network', ['document']);
    assert.equal(data.url, fixture.url);
  });
});

void describe('Network list window and failures', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    const burst =
      'Promise.allSettled([...Array(15).keys()].map((i) => fetch("/?n=" + i))' +
      '.concat(fetch("http://127.0.0.1:1/refused"))).then(() => "done")';
    await runJson('dom', ['eval', burst]);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('lists every captured request, not only the last 10', async () => {
    const data = await runJson<{ requests: ListedRequest[]; totalCount: number }>('network', [
      'list',
      '--last',
      '0',
    ]);
    assert.ok(data.totalCount >= 17, `totalCount ${data.totalCount}`);
    assert.equal(data.requests.length, data.totalCount);
    const peek = await runJson<{ totals: { network: number } }>('peek', []);
    assert.ok(peek.totals.network >= data.totalCount, `peek totals ${peek.totals.network}`);
  });

  void it('reports requests without a response as failed, not as HTTP errors', async () => {
    const failed = await runJson<{ requests: ListedRequest[] }>('network', [
      'list',
      '--preset',
      'failed',
    ]);
    assert.ok(
      failed.requests.some((r) => r.url.includes('/refused')),
      JSON.stringify(failed.requests)
    );
    const errors = await runJson<{ requests: ListedRequest[] }>('network', [
      'list',
      '--preset',
      'errors',
    ]);
    assert.ok(!errors.requests.some((r) => r.url.includes('/refused')));
  });
});

void describe('Full headers and cookies', () => {
  let fixture: FixtureServer;
  let cookieRequestId = '';

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await runJson('dom', [
      'eval',
      'fetch("/cookie").then(() => fetch("/?after-cookie")).then(() => 1)',
    ]);
    const list = await runJson<{ requests: ListedRequest[] }>('network', ['list', '--last', '0']);
    cookieRequestId = list.requests.find((r) => r.url.endsWith('/cookie'))?.requestId ?? '';
    assert.ok(cookieRequestId, 'cookie request captured');
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('captures Set-Cookie response headers', async () => {
    const data = await runJson<{ responseHeaders: Record<string, string> }>('network', [
      'headers',
      cookieRequestId,
    ]);
    const setCookie = Object.entries(data.responseHeaders).find(
      ([name]) => name.toLowerCase() === 'set-cookie'
    )?.[1];
    assert.match(setCookie ?? '', /fixture_session=abc/);
    assert.match(setCookie ?? '', /fixture_theme=dark/);
  });

  void it('captures the Cookie request header of later requests', async () => {
    const list = await runJson<{ requests: ListedRequest[] }>('network', ['list', '--last', '0']);
    const after = list.requests.find((r) => r.url.includes('after-cookie'));
    const data = await runJson<{ requestHeaders: Record<string, string> }>('network', [
      'headers',
      after?.requestId ?? '',
    ]);
    const cookie = Object.entries(data.requestHeaders).find(
      ([name]) => name.toLowerCase() === 'cookie'
    )?.[1];
    assert.match(cookie ?? '', /fixture_session=abc/);
  });

  void it('filters by response header in network list', async () => {
    const data = await runJson<{ requests: ListedRequest[] }>('network', [
      'list',
      '--filter',
      'has-response-header:set-cookie',
    ]);
    assert.deepEqual(
      data.requests.map((r) => r.requestId),
      [cookieRequestId]
    );
    assert.ok(!('responseHeaders' in (data.requests[0] ?? {})), 'headers not in list output');
  });

  void it('exports cookies to HAR', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-har-')), 'cookies.har');
    const result = await runCommand('network', ['har', file], { timeout: 30000 });
    assert.equal(result.exitCode, 0, result.stderr);
    const har = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      log: {
        entries: Array<{
          request: { url: string };
          response: { cookies: Array<{ name: string }> };
        }>;
      };
    };
    const entry = har.log.entries.find((e) => e.request.url.endsWith('/cookie'));
    assert.deepEqual(entry?.response.cookies.map((c) => c.name).sort(), [
      'fixture_session',
      'fixture_theme',
    ]);
  });
});

void describe('HAR export with --all', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(fixture.url, ['--port', String(port), '--headless', '--all'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await runJson('dom', [
      'eval',
      'new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(1); img.src = "/pixel.png"; document.body.append(img); })',
    ]);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const list = await runJson<{ requests: ListedRequest[] }>('network', ['list', '--last', '0']);
      const pixel = list.requests.find((r) => r.url.endsWith('/pixel.png'));
      const details = pixel
        ? await runJson<{ item: { responseBody?: string } }>('details', [
            'network',
            pixel.requestId,
          ])
        : undefined;
      if (details?.item.responseBody) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('exports binary bodies once base64-encoded, in start order, with the browser', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-har-')), 'all.har');
    const result = await runCommand('network', ['har', file], { timeout: 30000 });
    assert.equal(result.exitCode, 0, result.stderr);
    const har = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      log: {
        browser?: { name: string; version: string };
        entries: Array<{
          startedDateTime: string;
          request: { url: string };
          response: { content: { text?: string; encoding?: string } };
        }>;
      };
    };
    const pixel = har.log.entries.find((e) => e.request.url.endsWith('/pixel.png'));
    assert.equal(pixel?.response.content.encoding, 'base64');
    const bytes = Buffer.from(pixel?.response.content.text ?? '', 'base64');
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', 'decodes to the original PNG');
    assert.equal(har.log.browser?.name, 'Chrome');
    const starts = har.log.entries.map((e) => e.startedDateTime);
    assert.deepEqual(starts, [...starts].sort());
  });
});
