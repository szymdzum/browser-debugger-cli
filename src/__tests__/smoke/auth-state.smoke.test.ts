/**
 * Saved browser auth state smoke test (#454).
 *
 * A fixture app logs in with a session cookie (HttpOnly, no Expires: Chrome
 * drops it when it quits), a localStorage token and a sessionStorage value,
 * and its secure page embeds a same-site iframe of a second origin with its
 * own storage. `bdg state save` → `bdg stop` → `bdg <url> --state` must come
 * back logged in with every origin's storage; `state load` into a named
 * session restores the cookies and the storage of the origins on its page.
 * The file is 0600 and no output prints a value; a bad file exits 81.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { AddressInfo } from 'node:net';

import { runCommand } from '@/__testutils__/commandRunner.js';

/** Values that must never show up in bdg's output */
const SECRETS = ['LS-SECRET-A', 'SS-SECRET-A', 'LS-SECRET-B', 'SS-SECRET-B'];

/** Prefix of the session cookie value (the rest is random) */
const SID_PREFIX = 'SID-SECRET-';

/** Short session base dir: a named session's socket path must stay under ~100 bytes */
const sessionBaseDir = fs.mkdtempSync('/tmp/bdg-state-');
const sessionEnv = { BDG_SESSION_DIR: sessionBaseDir };

/** Where the state files go */
const fileDir = fs.mkdtempSync('/tmp/bdg-state-files-');

/** A running fixture app: origin A (the app) and origin B (same site, other port) */
interface AuthFixture {
  a: string;
  b: string;
  close: () => Promise<void>;
}

/**
 * Listen on an ephemeral port of 127.0.0.1.
 *
 * @param handler - Request handler
 * @returns Server and its origin
 */
async function listen(
  handler: http.RequestListener
): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/**
 * Send an HTML page.
 *
 * @param res - Response
 * @param body - HTML
 * @param headers - Extra headers
 */
function html(
  res: http.ServerResponse,
  body: string,
  headers: http.OutgoingHttpHeaders = {}
): void {
  res.writeHead(200, { 'Content-Type': 'text/html', ...headers });
  res.end(`<!doctype html>${body}`);
}

/**
 * Start the fixture app.
 *
 * Origin A: `/login` (redirects to `/secure` when logged in), `/authenticate`
 * (sets the session cookie and A's storage, loads B's `/init` frame),
 * `/secure` (redirects to `/login` without a valid cookie; shows A's storage
 * and embeds B's `/frame`). Origin B: `/init` sets B's storage, `/frame`
 * shows it.
 *
 * @returns Fixture handle
 */
async function startAuthFixture(): Promise<AuthFixture> {
  const sessions = new Set<string>();
  const loggedIn = (req: http.IncomingMessage): boolean => {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    return sid !== undefined && sessions.has(sid);
  };
  const showStorage = (keys: [string, string]): string =>
    `<p id="storage"></p><script>document.getElementById('storage').textContent = [localStorage.getItem('${keys[0]}'), sessionStorage.getItem('${keys[1]}')].join('|')</script>`;
  const b = await listen((req, res) => {
    if (req.url === '/init') {
      html(
        res,
        "<script>localStorage.setItem('b', 'LS-SECRET-B'); sessionStorage.setItem('bs', 'SS-SECRET-B')</script>"
      );
      return;
    }
    html(res, `<title>frame</title>${showStorage(['b', 'bs'])}`);
  });
  const a = await listen((req, res) => {
    if (req.url === '/authenticate') {
      const sid = `${SID_PREFIX}${Math.random().toString(36).slice(2)}`;
      sessions.add(sid);
      html(
        res,
        `<title>Logged in</title><script>localStorage.setItem('token', 'LS-SECRET-A'); sessionStorage.setItem('tab', 'SS-SECRET-A')</script><iframe src="${b.origin}/init" onload="document.body.append(Object.assign(document.createElement('p'), { id: 'ready' }))"></iframe>`,
        { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly` }
      );
      return;
    }
    if (req.url === '/secure' && !loggedIn(req)) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    if (req.url === '/secure') {
      html(
        res,
        `<title>Secure Area</title><h1>Secure Area</h1>${showStorage(['token', 'tab'])}<iframe src="${b.origin}/frame"></iframe>`
      );
      return;
    }
    if (loggedIn(req)) {
      res.writeHead(302, { Location: '/secure' });
      res.end();
      return;
    }
    html(res, '<title>Login</title><h1>Login</h1><a href="/authenticate">Log in</a>');
  });
  return {
    a: a.origin,
    b: b.origin,
    close: async () => {
      a.server.closeAllConnections();
      b.server.closeAllConnections();
      await Promise.all([a, b].map(({ server }) => new Promise((r) => server.close(r))));
    },
  };
}

/**
 * Run a bdg command in this test's session directory.
 *
 * @param command - Command (or URL)
 * @param args - Arguments
 * @returns Exit code and output
 */
async function bdg(
  command: string,
  args: string[] = []
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runCommand(command, args, { timeout: 60000, env: sessionEnv });
}

/**
 * Run a bdg command with `--json` and read its envelope.
 *
 * @param command - Command (or URL)
 * @param args - Arguments
 * @returns Exit code, envelope and the whole output
 */
async function bdgJson<T>(
  command: string,
  args: string[] = []
): Promise<{ exitCode: number; envelope: T & { data: never }; output: string }> {
  const result = await bdg(command, [...args, '--json']);
  return {
    exitCode: result.exitCode,
    envelope: JSON.parse(result.stdout || '{}') as T & { data: never },
    output: result.stdout + result.stderr,
  };
}

/**
 * Evaluate an expression in the page (or a frame) and return its value.
 *
 * @param expression - JavaScript
 * @param session - Named session
 * @param frame - Frame index
 * @returns Value
 */
async function evaluate(expression: string, session?: string, frame?: string): Promise<unknown> {
  const result = await bdg('dom', [
    'eval',
    expression,
    '--json',
    ...(session ? ['--session', session] : []),
    ...(frame ? ['--frame', frame] : []),
  ]);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  return (JSON.parse(result.stdout) as { data: { result: unknown } }).data.result;
}

/**
 * Assert that output holds none of the secret values.
 *
 * @param output - stdout and stderr
 */
function assertNoValues(output: string): void {
  for (const secret of [...SECRETS, SID_PREFIX]) {
    assert.ok(!output.includes(secret), `output must not contain ${secret}: ${output}`);
  }
}

/** Counts of an origin in a summary */
interface OriginCounts {
  origin: string;
  localStorage: number;
  sessionStorage: number;
}

/** What save, load and a start with --state report */
interface Summary {
  file?: string;
  cookies: number;
  origins: OriginCounts[];
  skipped?: Array<{ origin: string; reason: string }>;
  reload?: { url: string };
  state?: Summary;
  targetUrl?: string;
}

void describe('auth state save and load', () => {
  let fixture: AuthFixture;
  const stateFile = path.join(fileDir, 'login.json');

  before(async () => {
    fixture = await startAuthFixture();
  });

  after(async () => {
    for (const args of [['--force'], ['--force', '--session', 'other']]) {
      await bdg('cleanup', args);
    }
    await fixture.close();
    fs.rmSync(sessionBaseDir, { recursive: true, force: true });
    fs.rmSync(fileDir, { recursive: true, force: true });
  });

  void it('logs in, saves the state 0600 and prints counts only', async () => {
    const start = await bdg(`${fixture.a}/login`, ['--headless']);
    assert.equal(start.exitCode, 0, start.stderr);
    const login = await bdg('page', ['navigate', `${fixture.a}/authenticate`]);
    assert.equal(login.exitCode, 0, login.stdout + login.stderr);
    const ready = await bdg('dom', ['wait', '#ready', '--timeout', '10000']);
    assert.equal(ready.exitCode, 0, ready.stdout + ready.stderr);

    const saved = await bdgJson<{ data: Summary }>('state', ['save', stateFile]);
    assert.equal(saved.exitCode, 0, saved.output);
    assertNoValues(saved.output);
    const data = (saved.envelope as unknown as { data: Summary }).data;
    assert.equal(data.file, stateFile);
    assert.ok(data.cookies >= 1, 'the session cookie is saved');
    assert.deepEqual(
      [...data.origins].sort((x, y) => x.origin.localeCompare(y.origin)),
      [
        { origin: fixture.a, localStorage: 1, sessionStorage: 1 },
        { origin: fixture.b, localStorage: 1, sessionStorage: 1 },
      ].sort((x, y) => x.origin.localeCompare(y.origin))
    );
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);

    const file = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
      version: number;
      cookies: Array<{ name: string; session: boolean; httpOnly: boolean }>;
    };
    assert.equal(file.version, 1);
    const sid = file.cookies.find((cookie) => cookie.name === 'sid');
    assert.ok(sid?.session && sid.httpOnly, 'the HttpOnly session cookie is in the file');

    const human = await bdg('state', ['save', stateFile]);
    assert.equal(human.exitCode, 0, human.stderr);
    assertNoValues(human.stdout + human.stderr);
    assert.match(human.stdout + human.stderr, /Saved \d+ cookies?, storage of 2 origins/);
    assert.match(human.stdout + human.stderr, /readable by its owner only/);
  });

  void it('is still logged in after stop and a start with --state', async () => {
    const stop = await bdg('stop');
    assert.equal(stop.exitCode, 0, stop.stderr);

    const without = await bdgJson<{ data: Summary }>(`${fixture.a}/secure`, ['--headless']);
    assert.equal(without.exitCode, 0, without.output);
    assert.match(
      (without.envelope as unknown as { data: Summary }).data.targetUrl ?? '',
      /\/login$/,
      'the session cookie is gone after stop'
    );
    for (const origin of [fixture.a, fixture.b]) {
      const cleared = await bdg('cdp', [
        'Storage.clearDataForOrigin',
        '--params',
        JSON.stringify({ origin, storageTypes: 'local_storage' }),
      ]);
      assert.equal(cleared.exitCode, 0, `${cleared.stdout}${cleared.stderr}`);
    }
    assert.equal((await bdg('stop')).exitCode, 0);

    const start = await bdgJson<{ data: Summary }>(`${fixture.a}/secure`, [
      '--headless',
      '--state',
      stateFile,
    ]);
    assert.equal(start.exitCode, 0, start.output);
    assertNoValues(start.output);
    const data = (start.envelope as unknown as { data: Summary }).data;
    assert.match(data.targetUrl ?? '', /\/secure$/);
    assert.ok(data.state && data.state.cookies >= 1);
    assert.equal(data.state?.origins.length, 2);

    assert.equal(await evaluate('location.pathname'), '/secure');
    assert.equal(
      await evaluate("document.getElementById('storage').textContent"),
      'LS-SECRET-A|SS-SECRET-A'
    );
    assert.equal(
      await evaluate("document.getElementById('storage').textContent", undefined, '0'),
      'LS-SECRET-B|SS-SECRET-B'
    );
    assert.equal(await evaluate("document.cookie.includes('sid=')"), false, 'still HttpOnly');
  });

  void it('loads into a named session: cookies and the storage of the origins on its page', async () => {
    const start = await bdg(`${fixture.a}/login`, ['--headless', '--session', 'other']);
    assert.equal(start.exitCode, 0, start.stderr);
    assert.equal(await evaluate('location.pathname', 'other'), '/login');

    const loaded = await bdgJson<{ data: Summary }>('state', [
      'load',
      stateFile,
      '--session',
      'other',
    ]);
    assert.equal(loaded.exitCode, 0, loaded.output);
    assertNoValues(loaded.output);
    const data = (loaded.envelope as unknown as { data: Summary }).data;
    assert.ok(data.cookies >= 1);
    assert.deepEqual(data.origins, [{ origin: fixture.a, localStorage: 1, sessionStorage: 1 }]);
    assert.deepEqual(data.skipped, [{ origin: fixture.b, reason: 'not-on-page' }]);
    assert.match(data.reload?.url ?? '', /\/secure$/, 'the reload is logged in');
    assert.equal(
      await evaluate("document.getElementById('storage').textContent", 'other'),
      'LS-SECRET-A|SS-SECRET-A'
    );
  });

  void it('refuses an --origin the page has no frame of (83)', async () => {
    const result = await bdgJson<{ exitCode: number; suggestion?: string }>('state', [
      'save',
      path.join(fileDir, 'other.json'),
      '--origin',
      'https://not-on-the-page.example',
      '--session',
      'other',
    ]);
    assert.equal(result.exitCode, 83, result.output);
    assert.ok(result.envelope.suggestion);
    assert.ok(!fs.existsSync(path.join(fileDir, 'other.json')), 'no file written');
  });

  void it('exits 81 with a suggestion for a bad file or --state with --chrome-ws-url, before starting anything', async () => {
    const bad = path.join(fileDir, 'bad.json');
    fs.writeFileSync(bad, '{"version": 1, "cookies": "LS-SECRET-A"}');
    const notJson = path.join(fileDir, 'not.json');
    fs.writeFileSync(notJson, 'LS-SECRET-A');
    for (const [command, args] of [
      ['state', ['load', bad, '--session', 'other']],
      ['state', ['load', notJson, '--session', 'other']],
      ['state', ['load', path.join(fileDir, 'missing.json'), '--session', 'other']],
      [`${fixture.a}/secure`, ['--headless', '--session', 'fresh', '--state', notJson]],
      [
        `${fixture.a}/secure`,
        [
          '--chrome-ws-url',
          'ws://127.0.0.1:9/devtools/browser/x',
          '--session',
          'fresh',
          '--state',
          stateFile,
        ],
      ],
    ] as const) {
      const result = await bdgJson<{ exitCode: number; suggestion?: string }>(command, [...args]);
      assert.equal(result.exitCode, 81, result.output);
      assert.ok(result.envelope.suggestion, 'has a suggestion');
      assertNoValues(result.output);
    }
    assert.ok(
      !fs.existsSync(path.join(sessionBaseDir, 'sessions', 'fresh', 'daemon.sock')),
      'no session started'
    );
  });
});
