/**
 * Secrets in network output smoke test (#615).
 *
 * The `/net-secrets` fixture page sends credentials in headers
 * (`Authorization`, `X-API-Key`, `X-CSRF-Token`, `Cookie`, `Referer`), in
 * urlencoded, JSON and multipart request bodies, and in a WebSocket message,
 * and gets tokens in a JSON response body and a `Set-Cookie`; a second
 * server answers an OAuth-like redirect with a code in `Location`.
 * `details network`, `network headers` and `network document` show none of
 * these values by default, human or `--json` (each is `••••`, the field
 * names stay, and the output says that values were masked);
 * `--include-sensitive` shows them, with a warning.
 */

import * as http from 'http';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type * as net from 'net';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { NETWORK_SECRET_MARKER } from '@/__testutils__/fixturePages/networkSecretFixtures.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/** Shown instead of a secret value */
const MASK = '••••';

/** Any secret value of the fixture page, the `/har-login` response or the redirect */
const ANY_SECRET = new RegExp(`${NETWORK_SECRET_MARKER}|SECRET-(ACCESS|REFRESH|SESSION)`);

/** Redirect target of the OAuth-like server: a code in the query, a token in the fragment */
const CALLBACK_LOCATION = `/cb?code=LOC${NETWORK_SECRET_MARKER}&state=ok#access_token=FRAG${NETWORK_SECRET_MARKER}`;

/** Request as `network list --json` lists it */
interface ListedRequest {
  requestId: string;
  url: string;
  method?: string;
  status?: number;
  resourceType?: string;
}

/** What the tests read of `details network --json` */
interface DetailsJson {
  item: {
    url: string;
    requestBody?: string;
    responseBody?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    webSocket?: { frames: Array<{ payloadData: string }> };
  };
  masked?: boolean;
}

/** What the tests read of `network headers --json` */
interface HeadersJson {
  url: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  masked?: boolean;
}

/**
 * Run a bdg command and assert it succeeds.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Its stdout and stderr
 */
async function bdg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Run a bdg command with `--json` and return its envelope.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns The envelope, and the raw output
 */
async function bdgJson<T>(
  args: string[]
): Promise<{ data: T; warning?: string; stdout: string; stderr: string }> {
  const { stdout, stderr } = await bdg([...args, '--json']);
  const envelope = JSON.parse(stdout) as { data: T; warning?: string };
  return { ...envelope, stdout, stderr };
}

/**
 * Value of a header, whatever its case.
 *
 * @param headers - Header map
 * @param name - Header name
 * @returns Value, if present
 */
function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

/**
 * Every request captured so far.
 *
 * @returns Requests of `network list --last 0`
 */
async function listRequests(): Promise<ListedRequest[]> {
  return (await bdgJson<{ requests: ListedRequest[] }>(['network', 'list', '--last', '0'])).data
    .requests;
}

/**
 * Id of the captured request whose URL path is the one given.
 *
 * @param requests - Captured requests
 * @param pathname - URL path, e.g. `/net-form`
 * @returns Request id
 */
function requestId(requests: ListedRequest[], pathname: string): string {
  const request = requests.find((r) => new URL(r.url).pathname === pathname);
  assert.ok(request, `no request to ${pathname}: ${JSON.stringify(requests)}`);
  return request.requestId;
}

/**
 * Wait until the fixture page has sent all its requests and the WebSocket
 * echo came back (its title becomes `done`, within about 1 s of the start;
 * the wait allows 15 s).
 */
async function waitForPage(): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const title = await runCommand('dom', ['eval', 'document.title', '--json'], { timeout: 30000 });
    if (title.stdout.includes('"done"')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the fixture page did not finish its requests');
}

/**
 * Start a server that redirects `/authorize` to {@link CALLBACK_LOCATION}
 * and answers every other path with a short page.
 *
 * @returns The server and its URL
 */
async function startOAuthServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/authorize') {
      res.writeHead(302, { Location: CALLBACK_LOCATION });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>callback</title>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` };
}

void describe('Secrets in network output', () => {
  let fixture: FixtureServer;
  let oauth: { server: http.Server; url: string };
  let requests: ListedRequest[];

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    oauth = await startOAuthServer();
    const port = await getFreePort();
    const result = await runCommand(
      `${fixture.url}net-secrets`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    await waitForPage();
    requests = await listRequests();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
    oauth.server.closeAllConnections();
    await new Promise<void>((resolve) => oauth.server.close(() => resolve()));
  });

  void it('details network masks the form body, auth headers, cookies and Referer', async () => {
    const { stdout } = await bdg(['details', 'network', requestId(requests, '/net-form')]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.ok(stdout.includes(`user=tom&password=${MASK}`), stdout);
    assert.match(stdout, new RegExp(`authorization: Bearer ${MASK}$`, 'im'));
    assert.match(stdout, new RegExp(`x-api-key: ${MASK}$`, 'im'));
    assert.match(stdout, new RegExp(`x-csrf-token: ${MASK}$`, 'im'));
    assert.match(stdout, new RegExp(`cookie: pre=${MASK}$`, 'im'));
    assert.match(
      stdout,
      new RegExp(`referer: .*/net-secrets\\?access_token=${MASK}&lang=en$`, 'im')
    );
    assert.match(stdout, /--include-sensitive/, 'the output says values were masked');
  });

  void it('details network --json masks the same values and says so', async () => {
    const { data, stdout } = await bdgJson<DetailsJson>([
      'details',
      'network',
      requestId(requests, '/net-form'),
    ]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.equal(data.masked, true);
    assert.equal(data.item.requestBody, `user=tom&password=${MASK}`);
    assert.equal(header(data.item.requestHeaders, 'authorization'), `Bearer ${MASK}`);
    assert.equal(header(data.item.requestHeaders, 'x-api-key'), MASK);
  });

  void it('masks JSON request fields at any depth and keeps the others', async () => {
    const { data, stdout } = await bdgJson<DetailsJson>([
      'details',
      'network',
      requestId(requests, '/net-json'),
    ]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.equal(
      data.item.requestBody,
      `{"user":"tom","password":"${MASK}","profile":{"api_key":"${MASK}","city":"Leeds"}}`
    );
  });

  void it('masks a multipart password part and keeps the others', async () => {
    const { stdout } = await bdg(['details', 'network', requestId(requests, '/net-upload')]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.ok(stdout.includes('keep-me'), stdout);
    assert.ok(stdout.includes(MASK), stdout);
  });

  void it('masks tokens of a JSON response body and Set-Cookie values', async () => {
    const id = requestId(requests, '/har-login');
    const { stdout } = await bdg(['details', 'network', id]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.ok(stdout.includes(`"access_token":"${MASK}","refresh_token":"${MASK}"`), stdout);
    assert.ok(stdout.includes('"expires_in":3600'), stdout);
    assert.match(stdout, new RegExp(`set-cookie: har_session=${MASK}; Path=/; HttpOnly$`, 'im'));

    const body = await bdg(['details', 'network', id, '--body']);
    assert.doesNotMatch(body.stdout, ANY_SECRET);
    assert.ok(body.stdout.includes(`"access_token":"${MASK}"`), body.stdout);
  });

  void it('masks WebSocket message tokens', async () => {
    const id = requests.find((r) => r.resourceType === 'WebSocket')?.requestId ?? '';
    const human = await bdg(['details', 'network', id]);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    assert.ok(human.stdout.includes(`"token":"${MASK}","room":"lobby"`), human.stdout);
    const { data, stdout } = await bdgJson<DetailsJson>(['details', 'network', id]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.equal(data.masked, true);
    assert.ok(data.item.webSocket?.frames.every((f) => f.payloadData.includes(MASK)));
  });

  void it('network headers masks credentials, human and --json', async () => {
    const id = requestId(requests, '/net-form');
    const human = await bdg(['network', 'headers', id]);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    assert.match(human.stdout, new RegExp(`authorization:\\s+Bearer ${MASK}$`, 'im'));
    assert.match(human.stdout, /--include-sensitive/);

    const { data, stdout } = await bdgJson<HeadersJson>(['network', 'headers', id]);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.equal(data.masked, true);
    assert.equal(header(data.requestHeaders, 'x-csrf-token'), MASK);
    assert.equal(header(data.requestHeaders, 'cookie'), `pre=${MASK}`);
  });

  void it('--include-sensitive shows the values with a warning', async () => {
    const id = requestId(requests, '/net-form');
    const human = await bdg(['details', 'network', id, '--include-sensitive']);
    assert.ok(human.stdout.includes(`password=FORM${NETWORK_SECRET_MARKER}`), human.stdout);
    assert.ok(human.stdout.includes(`Bearer AUTH${NETWORK_SECRET_MARKER}`), human.stdout);
    assert.match(human.stderr, /Warning: .*credentials/i);

    const json = await bdgJson<HeadersJson>(['network', 'headers', id, '--include-sensitive']);
    assert.equal(header(json.data.requestHeaders, 'x-api-key'), `KEY${NETWORK_SECRET_MARKER}`);
    assert.equal(json.data.masked, undefined);
    assert.match(json.warning ?? '', /credentials/i);
  });

  void it('masks the code in Location and in the document URL, and cookies of network document', async () => {
    await bdg(['page', 'navigate', `${oauth.url}/authorize`]);
    const hop = (await listRequests()).find(
      (r) => r.url.endsWith('/authorize') && r.status === 302
    );
    assert.ok(hop, 'redirect hop captured');
    const details = await bdg(['details', 'network', hop.requestId]);
    assert.doesNotMatch(details.stdout, ANY_SECRET);
    assert.match(
      details.stdout,
      new RegExp(`location: /cb\\?code=${MASK}&state=ok#access_token=${MASK}$`, 'im')
    );

    const human = await bdg(['network', 'document']);
    assert.doesNotMatch(human.stdout, ANY_SECRET);
    const { data, stdout } = await bdgJson<HeadersJson>(['network', 'document']);
    assert.doesNotMatch(stdout, ANY_SECRET);
    assert.equal(data.masked, true);
    assert.equal(data.url, `${oauth.url}/cb?code=${MASK}&state=ok`);
    assert.match(header(data.requestHeaders, 'cookie') ?? '', new RegExp(`pre=${MASK}`));

    const raw = await bdgJson<HeadersJson>(['network', 'document', '--include-sensitive']);
    assert.equal(raw.data.url, `${oauth.url}/cb?code=LOC${NETWORK_SECRET_MARKER}&state=ok`);
  });
});
