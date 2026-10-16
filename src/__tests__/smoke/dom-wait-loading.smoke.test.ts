/**
 * Smoke test for the `bdg dom wait` timeout on a page that is still loading
 * (#775). The test serves its own page whose head scripts are requested but
 * never answered (the sockets stay open until the test ends), so the document
 * stays `loading` with those requests pending no matter how slow the machine
 * is. The timeout names them in the words of the start warning, with
 * credentials masked, and `--json` carries them as top-level `pending` and
 * `pendingCount` of the error envelope (human output does not print them).
 */

import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { after, before, describe, it } from 'node:test';

import type { Socket } from 'node:net';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';

/** Scripts the page requests; more than the three the timeout names */
const HANGING_SCRIPTS = 5;

/** The secret in the scripts' query string, which must never be shown */
const TOKEN = 'tok3nSECRETvalue';

/** The timeout error of `dom wait` as `--json` prints it */
interface WaitTimeoutEnvelope {
  exitCode: number;
  pending?: Array<{ method: string; url: string; pendingMs: number }>;
  pendingCount?: number;
}

/**
 * Run `bdg dom wait` and return its result.
 *
 * @param args - Arguments after `dom wait`
 * @returns Exit code and output
 */
function domWait(args: string[]): ReturnType<typeof runCommand> {
  return runCommand('dom', ['wait', ...args, '--timeout', '500'], { timeout: 60000 });
}

/**
 * A page whose head scripts are requested and never answered.
 *
 * @param name - Prefix of the script paths
 * @returns HTML
 */
function hangingPage(name: string): string {
  const scripts = Array.from(
    { length: HANGING_SCRIPTS },
    (_, n) => `<script src="/${name}${n}.js?token=${TOKEN}"></script>`
  ).join('');
  return `<!doctype html><html><head><title>${name}</title>${scripts}</head><body></body></html>`;
}

void describe('dom wait timeout on a loading page (#775)', () => {
  let server: http.Server;
  const sockets = new Set<Socket>();
  let origin = '';

  before(async () => {
    await cleanupAllSessions();
    const pages: Record<string, string> = {
      '/page': hangingPage('hang'),
      '/page2': hangingPage('second'),
    };
    server = http.createServer((req, res) => {
      const page = pages[req.url ?? ''];
      if (page === undefined) return;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    const port = await getFreePort();
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${port}`;
    const start = await runCommand(
      `${origin}/page`,
      ['--port', String(await getFreePort()), '--headless'],
      { timeout: 90000 }
    );
    assert.equal(start.exitCode, 0, start.stdout + start.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
  });

  void it('names the pending requests in human output, without the secret or the array', async () => {
    const result = await domWait(['--load']);
    assert.equal(result.exitCode, 102, result.stdout + result.stderr);
    assert.match(
      result.stderr,
      /The page is still loading; waiting on: GET [^\n]*\/hang\d\.js[^\n]* \(pending [^\n]*and \d+ more \(all of them with bdg peek\)/
    );
    assert.ok(!result.stderr.includes(TOKEN), result.stderr);
    assert.doesNotMatch(result.stderr, /pendingMs|"pending"/);
  });

  void it('--json carries pending and pendingCount, urls masked', async () => {
    const result = await domWait(['--load', '--json']);
    assert.equal(result.exitCode, 102, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout) as WaitTimeoutEnvelope;
    assert.equal(envelope.pending?.length, 3, result.stdout);
    assert.equal(envelope.pending?.[0]?.method, 'GET');
    assert.ok((envelope.pendingCount ?? 0) > 3, result.stdout);
    assert.ok(!result.stdout.includes(TOKEN), result.stdout);
  });

  void it('a selector wait without --load names them too', async () => {
    const result = await domWait(['#never', '--json']);
    assert.equal(result.exitCode, 102, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout) as WaitTimeoutEnvelope;
    assert.ok((envelope.pending?.length ?? 0) > 0, result.stdout);
  });

  void it('names only the requests of the current document after a navigation', async () => {
    const navigate = await runCommand('page', ['navigate', `${origin}/page2`, '--no-wait'], {
      timeout: 60000,
    });
    assert.equal(navigate.exitCode, 0, navigate.stdout + navigate.stderr);
    const deadline = Date.now() + 30000;
    for (;;) {
      const peek = await runCommand('peek', ['--json'], { timeout: 60000 });
      const url = (JSON.parse(peek.stdout) as { data: { target: { url: string } } }).data.target
        .url;
      if (url.endsWith('/page2')) break;
      assert.ok(Date.now() < deadline, 'the second page never became current');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const result = await domWait(['--load', '--json']);
    assert.equal(result.exitCode, 102, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout) as WaitTimeoutEnvelope;
    assert.ok((envelope.pending?.length ?? 0) > 0, result.stdout);
    assert.ok(
      envelope.pending?.every((request) => request.url.includes('/second')),
      result.stdout
    );
  });
});
