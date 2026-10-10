/**
 * Blocked cookies smoke test (#493).
 *
 * The session starts on the API server's seed page (localhost), which stores
 * a `SameSite=Lax` cookie, then opens a page on 127.0.0.1 (another site)
 * whose response sets a `SameSite=None` cookie over http and one for
 * `Domain=example.com`, both rejected, and which fetches the API with
 * credentials: the Lax cookie is not sent. `details network` and `--json`
 * name each cookie with its reason, `network list` marks and filters the two
 * requests, and no cookie value appears in that output or a default HAR.
 *
 * Chrome reports the cookies in ExtraInfo events that may come after the
 * request finished, so the test waits until they are there, not for a fixed
 * time.
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import {
  COOKIE_SECRET,
  startCookieFixtures,
  type CookieFixtures,
} from '@/__testutils__/cookieFixtures.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import type { NetworkRequest } from '@/types.js';

/** How long Chrome may take to load the page, make the fetch and report its cookies */
const DEADLINE_MS = 10000;

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Its stdout
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * Requests from `network list --json`.
 *
 * @param filter - `--filter` DSL, if any
 * @returns Requests
 */
async function listRequests(filter?: string): Promise<NetworkRequest[]> {
  const args = [
    'network',
    'list',
    '--last',
    '0',
    '--json',
    ...(filter ? ['--filter', filter] : []),
  ];
  return (JSON.parse(await bdg(args)) as { data: { requests: NetworkRequest[] } }).data.requests;
}

/**
 * Wait until the page and its fetch finished with their blocked cookies.
 *
 * @param fixtures - Fixture URLs
 * @returns The page's document request and the fetch
 */
async function waitForBlockedCookies(
  fixtures: CookieFixtures
): Promise<{ page: NetworkRequest; api: NetworkRequest }> {
  const deadline = Date.now() + DEADLINE_MS;
  for (;;) {
    const requests = await listRequests();
    const page = requests.find((r) => r.url === fixtures.pageUrl);
    const api = requests.find((r) => r.url === fixtures.apiUrl);
    const ready =
      page?.duration !== undefined &&
      api?.duration !== undefined &&
      (page.blockedCookies?.length ?? 0) >= 2 &&
      (api.blockedCookies?.length ?? 0) >= 1;
    if (ready || Date.now() > deadline) {
      assert.ok(page && api, `requests not captured: ${JSON.stringify(requests)}`);
      return { page, api };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * A request's details, in JSON.
 *
 * @param requestId - Request id
 * @returns The request as `details network --json` reports it
 */
async function detailsJson(requestId: string): Promise<NetworkRequest> {
  const output = await bdg(['details', 'network', requestId, '--json']);
  return (JSON.parse(output) as { data: { item: NetworkRequest } }).data.item;
}

/**
 * The `Blocked Cookies` block of `details network`.
 *
 * @param requestId - Request id
 * @returns Its lines (after the heading and separator)
 */
async function blockedCookieLines(requestId: string): Promise<string[]> {
  const lines = (await bdg(['details', 'network', requestId])).split('\n');
  const start = lines.findIndex((line) => line === 'Blocked Cookies:');
  if (start === -1) return [];
  const rest = lines.slice(start + 2);
  const end = rest.findIndex((line) => line.trim() === '');
  return end === -1 ? rest : rest.slice(0, end);
}

void describe('Blocked cookies', () => {
  let fixtures: CookieFixtures;
  let page: NetworkRequest;
  let api: NetworkRequest;

  before(async () => {
    await cleanupAllSessions();
    fixtures = await startCookieFixtures();
    const port = await getFreePort();
    const started = await runCommand(fixtures.seedUrl, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(started.exitCode, 0, started.stderr);
    await bdg(['page', 'navigate', fixtures.pageUrl]);
    ({ page, api } = await waitForBlockedCookies(fixtures));
  });

  after(async () => {
    await cleanupAllSessions();
    await fixtures.close();
    removeTempDirs();
  });

  void it('names the rejected Set-Cookies of the page with their reasons', async () => {
    const details = await detailsJson(page.requestId);
    assert.deepEqual(
      details.blockedCookies?.map((c) => [c.name, c.kind, c.reasons]),
      [
        ['nosecure', 'set-rejected', ['SameSiteNoneInsecure']],
        ['wrongdomain', 'set-rejected', ['InvalidDomain']],
      ]
    );

    const lines = await blockedCookieLines(page.requestId);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[0] ?? '', /^ {2}nosecure +set rejected: SameSiteNoneInsecure$/);
    assert.match(lines[1] ?? '', /^ {2}wrongdomain +set rejected: InvalidDomain$/);
  });

  void it('names the Lax cookie the cross-site fetch did not send', async () => {
    const details = await detailsJson(api.requestId);
    assert.deepEqual(
      details.blockedCookies?.map((c) => [c.name, c.kind]),
      [['tp_lax', 'not-sent']]
    );
    assert.match(details.blockedCookies?.[0]?.reasons.join() ?? '', /^(Schemeful)?SameSiteLax$/);

    const lines = await blockedCookieLines(api.requestId);
    assert.match(lines.join('\n'), /^ {2}tp_lax +not sent: (Schemeful)?SameSiteLax$/);
  });

  void it('leaves out cookies of other sites (DomainMismatch)', () => {
    const notSent = (page.blockedCookies ?? []).filter((c) => c.kind === 'not-sent');
    assert.deepEqual(notSent, [], 'tp_lax belongs to localhost, the page is on 127.0.0.1');
  });

  void it('marks and filters the requests in network list', async () => {
    const blocked = (await listRequests('has-blocked-cookies:*')).map((r) => r.url);
    assert.deepEqual(blocked.sort(), [fixtures.apiUrl, fixtures.pageUrl].sort());
    assert.deepEqual(
      (await listRequests('has-blocked-cookies:InvalidDomain')).map((r) => r.url),
      [fixtures.pageUrl]
    );
    assert.ok(
      (await listRequests('!has-blocked-cookies:*')).some((r) => r.url === fixtures.seedUrl),
      'the seed page had no cookie blocked'
    );

    const rows = (await bdg(['network', 'list', '--verbose'])).split('\n');
    const row = (url: string): string => rows.find((line) => line.includes(url)) ?? '';
    assert.match(row(fixtures.pageUrl), /⚠ cookie blocked$/);
    assert.match(row(fixtures.apiUrl), /⚠ cookie blocked$/);
    assert.doesNotMatch(row(fixtures.seedUrl), /cookie blocked/);
  });

  void it('never shows a cookie value', async () => {
    const outputs = [
      JSON.stringify(await listRequests()),
      (await blockedCookieLines(page.requestId)).join('\n'),
      JSON.stringify((await detailsJson(api.requestId)).blockedCookies),
    ];
    for (const output of outputs) assert.ok(!output.includes(COOKIE_SECRET), output);

    const file = path.join(makeTempDir('bdg-cookies-'), 'out.har');
    await bdg(['network', 'har', file]);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(COOKIE_SECRET), 'default HAR is sanitized');
  });
});
