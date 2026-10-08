/**
 * JSON contract smoke test.
 *
 * Every `--json` invocation must print exactly one response envelope, on one
 * line when stdout is piped:
 * `{ version, success: true, data }` or `{ version, success: false, error, exitCode }`,
 * with `exitCode` equal to the process exit code and no envelope fields nested
 * inside `data`. Covers success and failure paths with and without a session.
 */

import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions, isDaemonRunning } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

const CLI_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist/index.js'
);

interface Envelope {
  version: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  exitCode?: number;
  suggestion?: string;
  warning?: string;
}

/**
 * Run a command and assert its stdout is a valid response envelope.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Parsed envelope
 */
async function expectEnvelope(args: string[], expectedExit: number): Promise<Envelope> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const label = `bdg ${args.join(' ')}`;
  let envelope: Envelope;
  try {
    envelope = JSON.parse(result.stdout) as Envelope;
  } catch {
    assert.fail(`${label}: stdout is not one JSON document:\n${result.stdout}\n${result.stderr}`);
  }
  assert.equal(result.exitCode, expectedExit, `${label}: exit code (stderr: ${result.stderr})`);
  assert.doesNotMatch(result.stdout.trimEnd(), /\n/, `${label}: piped envelope on one line`);
  assert.equal(typeof envelope.version, 'string', `${label}: version`);
  if (envelope.success) {
    assert.ok('data' in envelope, `${label}: success without data`);
    const data = envelope.data ?? {};
    assert.ok(!('success' in data), `${label}: nested success flag in data`);
  } else {
    assert.equal(typeof envelope.error, 'string', `${label}: error`);
    assert.equal(envelope.exitCode, expectedExit, `${label}: exitCode field`);
    assert.doesNotMatch(envelope.error ?? '', /^Error: /, `${label}: error prefix`);
  }
  return envelope;
}

void describe('JSON contract', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports a missing session with exit 83 (status: inactive, exit 0)', async () => {
    for (const args of [
      ['peek', '--json'],
      ['network', 'list', '--json'],
      ['console', '--json'],
      ['dom', 'query', 'p', '--json'],
      ['dom', 'a11y', 'tree', '--json'],
      ['details', 'network', '1', '--json'],
      ['stop', '--json'],
    ]) {
      await expectEnvelope(args, 83);
    }
    const status = await expectEnvelope(['status', '--json'], 0);
    assert.equal(status.data?.['active'], false);
  });

  void it('answers --version and bare command groups with envelopes', async () => {
    const version = await expectEnvelope(['--version', '--json'], 0);
    assert.equal(typeof version.data?.['version'], 'string');
    await expectEnvelope(['dom', '--json'], 81);
    await expectEnvelope(['dom', 'a11y', '--json'], 81);

    const bare = await runCommand('--json', [], { timeout: 15000 });
    assert.equal(bare.exitCode, 0);
    assert.ok(
      'command' in (JSON.parse(bare.stdout) as object),
      'bare --json prints the help schema'
    );
    const status = await expectEnvelope(['--json', 'status'], 0);
    assert.equal(status.data?.['active'], false, '--json before the subcommand is honored');

    const help = await runCommand('help', ['dom'], { timeout: 15000 });
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /Usage: bdg dom/);
    assert.equal(await isDaemonRunning(), false, '`bdg help` must not start a session');
  });

  void it('reports usage and validation errors with exit 81', async () => {
    for (const args of [
      ['peek', '--bogus', '--json'],
      ['dom', 'query', '--json'],
      ['peek', '--last', 'abc', '--json'],
      ['network', 'list', '--preset', 'nope', '--json'],
      [fixture.url, '--port', 'abc', '--json'],
      ['dom', 'click', 'button', '--index', 'abc', '--json'],
      ['tabs', '--json'],
      ['dom', 'screenshot', 'x.png', '--quality', '101', '--json'],
      ['--port', '9333', '--json'],
      [fixture.url, '--chrome-flags', '--remote-debugging-port=9999', '--json'],
      ['dom', 'scroll', '--top', '--bottom', '--json'],
      ['dom', 'scroll', 'footer', '--down', '100', '--json'],
      ['dom', 'click', '0', '--index', '1', '--json'],
      [fixture.url, '-u', '/etc/hosts', '--json'],
      [
        fixture.url,
        '--chrome-ws-url',
        'ws://127.0.0.1:1/devtools/browser/x',
        '--port',
        '9333',
        '--json',
      ],
    ]) {
      await expectEnvelope(args, 81);
    }
    for (const url of ['', 'javascript:alert(1)']) await expectEnvelope([url, '--json'], 80);
  });

  void it('suggests a fix for every argument parser error', async () => {
    const cases: [string[], RegExp][] = [
      [['peek', '--lsat', '--json'], /^Did you mean: --last\?$/],
      [['dom', 'query', 'p', '--sesion', 'a', '--json'], /^Did you mean: --session\?$/],
      [['dom', 'query', 'p', '--frobnicate', '--json'], /^Run "bdg dom query --help"/],
      [['dom', 'query', '--json'], /^Run "bdg dom query --help"/],
      [['network', 'list', '--json', '--last'], /^Run "bdg network list --help"/],
      [['console', '--level', 'foo', '--json'], /^Run "bdg console --help"/],
      [['dom', '--json'], /^Run "bdg dom --help"/],
      [['cdp', '--search', 'cookie', '--list', '--json'], /^Run "bdg cdp --help"/],
    ];
    for (const [args, suggestion] of cases) {
      const envelope = await expectEnvelope(args, 81);
      assert.match(String(envelope.suggestion), suggestion, `bdg ${args.join(' ')}`);
    }
    const human = await runCommand('peek', ['--lsat']);
    assert.equal(human.exitCode, 81);
    assert.match(human.stderr, /^Error: unknown option '--lsat'\nDid you mean: --last\?$/m);
  });

  void it('prints compact help, per-command details and the full help on request', async () => {
    const compact = await runCommand('--help', ['--json']);
    const full = await runCommand('--help', ['--json', '--full']);
    const query = await runCommand('dom', ['query', '--help', '--json']);
    assert.ok(compact.stdout.length * 3 < full.stdout.length, 'compact help is much smaller');
    assert.doesNotMatch(compact.stdout, /\n {2}"/, 'help JSON is not indented');
    const queryHelp = JSON.parse(query.stdout) as { path: string; command: { options: object[] } };
    assert.equal(queryHelp.path, 'bdg dom query');
    assert.ok(JSON.stringify(queryHelp.command.options).includes('"behavior"'));
  });

  void it('prints cdp discovery as text and rejects an empty search', async () => {
    const search = await runCommand('cdp', ['--search', 'cookie']);
    assert.equal(search.exitCode, 0, search.stderr);
    assert.match(search.stdout, /^\d+ methods match "cookie":\n {2}\S/);
    assert.match(search.stdout, /Network\.getCookies +Returns all browser cookies/);
    const none = await runCommand('cdp', ['--search', 'zzzqqq']);
    assert.match(none.stdout, /No CDP method matches "zzzqqq"/);
    const empty = await expectEnvelope(['cdp', '--search', ' ', '--json'], 81);
    assert.equal(empty.error, 'Empty search query');
  });

  void it('describes redirects, $ref enums and types', async () => {
    const redirected = await expectEnvelope(
      ['cdp', 'DOM.highlightNode', '--describe', '--json'],
      0
    );
    const redirect = redirected.data?.['redirect'] as { method: string; parameters: unknown[] };
    assert.equal(redirect.method, 'Overlay.highlightNode');
    assert.ok(JSON.stringify(redirect.parameters).includes('"highlightConfig"'));
    const human = await runCommand('cdp', ['DOM.highlightNode', '--describe']);
    assert.match(human.stdout, /Implemented by Overlay\.highlightNode \(redirect\)/);
    const setCookie = await runCommand('cdp', ['Network.setCookie', '--describe']);
    assert.match(setCookie.stdout, /sameSite\?: CookieSameSite \(Strict\|Lax\|None\)/);
    const type = await expectEnvelope(['cdp', 'Network.CookieSameSite', '--describe', '--json'], 0);
    assert.deepEqual(type.data?.['enum'], ['Strict', 'Lax', 'None']);
    const typo = await expectEnvelope(['cdp', 'Network.getCookes', '--json'], 81);
    assert.match(String(typo.suggestion), /Network\.getCookies/);
    assert.match(String(typo.suggestion), /bdg cdp Network\.getCookes --send-anyway/);
  });

  void it('delivers output larger than a pipe buffer to a slow reader', async () => {
    const result = await runCommand('--help', ['--json', '--full'], { readDelay: 500 });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.length > 65536, `help JSON is ${result.stdout.length} bytes`);
    assert.doesNotThrow(() => JSON.parse(result.stdout), 'help JSON is complete');
  });

  void it('exits quietly when the reader closes the pipe early', async () => {
    const child = spawn('node', [CLI_PATH, '--help', '--json', '--full'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.once('data', () => child.stdout.destroy());
    const [code] = (await once(child, 'close')) as [number | null];
    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stderr, /EPIPE/);
  });

  void it('refuses start URLs that cannot be loaded, without leaving a session', async () => {
    const port = await getFreePort();
    await expectEnvelope(['ftp://example.com', '--json'], 80);
    const failed = await expectEnvelope(
      ['http://127.0.0.1:1/', '--port', String(port), '--headless', '--json'],
      80
    );
    assert.match(failed.error ?? '', /Could not load/);
    const deadline = Date.now() + 5000;
    while ((await isDaemonRunning()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await isDaemonRunning(), false, 'no session after a failed load');
  });

  void it('reports the HTTP status of an error page at start', async () => {
    const port = await getFreePort();
    const started = await expectEnvelope(
      [`${fixture.url}error-page`, '--port', String(port), '--headless', '--json'],
      0
    );
    assert.equal(started.data?.['documentStatus'], 500);
    await expectEnvelope(['stop', '--json'], 0);
  });

  void it('starts a session with a JSON result', async () => {
    const port = await getFreePort();
    const started = await expectEnvelope(
      [fixture.url, '--port', String(port), '--headless', '--json'],
      0
    );
    assert.equal(started.data?.['targetUrl'], fixture.url);
    assert.equal(started.data?.['port'], port);
  });

  void it('returns single envelopes with the documented shapes', async () => {
    const peek = await expectEnvelope(['peek', '--network', '--json'], 0);
    assert.ok(Array.isArray(peek.data?.['network']), 'peek: data.network');
    assert.ok(!('console' in (peek.data ?? {})), 'peek --network: console filtered out');

    const list = await expectEnvelope(['network', 'list', '--last', '1', '--json'], 0);
    assert.ok(Array.isArray(list.data?.['requests']));
    assert.ok((list.data?.['requests'] as unknown[]).length <= 1, 'network list honors --last');
    assert.equal(typeof list.data?.['totalCount'], 'number');
    assert.equal(typeof list.data?.['filteredCount'], 'number');

    const status = await expectEnvelope(['status', '--json'], 0);
    assert.equal(status.data?.['active'], true);
    const page = await expectEnvelope(['page', 'info', '--json'], 0);
    assert.equal(page.data?.['url'], fixture.url);
    assert.equal(typeof page.data?.['title'], 'string');
    const human = await runCommand('status', []);
    assert.match(human.stdout, /^Session active: http:\/\/127\.0\.0\.1:\d+\/ — /);
    assert.ok(!('version' in (status.data ?? {})), 'status: version only in the envelope');

    await expectEnvelope(['console', '--list', '--json'], 0);
    await expectEnvelope(['dom', 'query', 'button', '--json'], 0);
    await expectEnvelope(['dom', 'a11y', 'tree', '--json'], 0);
    await expectEnvelope(['dom', 'eval', '1+1', '--json'], 0);
    const cdp = await expectEnvelope(['cdp', 'Browser.getVersion', '--json'], 0);
    assert.equal(typeof cdp.data?.['result'], 'object', 'cdp accepts --json');

    const badParams = await expectEnvelope(
      ['cdp', 'DOM.getBoxModel', '--params', '{}', '--json'],
      81
    );
    assert.match(String(badParams.suggestion), /bdg cdp DOM\.getBoxModel --describe/);
    const noNode = await expectEnvelope(
      ['cdp', 'DOM.getBoxModel', '--params', '{"nodeId":999999}', '--json'],
      83
    );
    assert.match(String(noNode.suggestion), /DOM\.getDocument/);
    const madeUp = await expectEnvelope(['cdp', 'Nonexistent.method', '--json'], 83);
    assert.match(String(madeUp.error), /^This Chrome doesn't implement Nonexistent\.method/);
    assert.doesNotMatch(String(madeUp.suggestion), /--describe/);
    assert.match(String(madeUp.warning), /^Nonexistent\.method is not in the bundled protocol/);
    const forced = await expectEnvelope(
      ['cdp', 'Network.getCookes', '--send-anyway', '--json'],
      83
    );
    assert.match(String(forced.error), /^This Chrome doesn't implement Network\.getCookes/);
    assert.match(String(forced.warning), /^Network\.getCookes is not in the bundled protocol/);
    const unlisted = await runCommand('cdp', ['Storage.getRelatedWebsiteSets']);
    assert.notEqual(unlisted.exitCode, 81, 'a method missing from the schema reaches Chrome');
    assert.match(
      unlisted.stderr,
      /Warning: Storage\.getRelatedWebsiteSets is not in the bundled protocol .*; sending it to Chrome as is/
    );
    const cdpHuman = await runCommand('cdp', ['Browser.getVersion']);
    assert.equal(cdpHuman.exitCode, 0, cdpHuman.stderr);
    assert.match(cdpHuman.stdout, /"product":/, 'cdp prints the result without --json');
    assert.doesNotMatch(cdpHuman.stdout, /"success"/, 'cdp prints no envelope without --json');

    const emulated = await expectEnvelope(
      ['page', 'emulate', '--viewport', '900x700', '--color-scheme', 'dark', '--json'],
      0
    );
    assert.deepEqual(emulated.data?.['emulated'], {
      viewport: { width: 900, height: 700 },
      colorScheme: 'dark',
    });
    const width = await expectEnvelope(['dom', 'eval', 'innerWidth', '--json'], 0);
    assert.equal(width.data?.['result'], 900);
    const phone = await expectEnvelope(['page', 'emulate', '--mobile', '--json'], 0);
    assert.deepEqual(phone.data?.['emulated'], {
      viewport: { width: 390, height: 844, mobile: true },
      colorScheme: 'dark',
    });
    const device = await expectEnvelope(
      [
        'dom',
        'eval',
        '[innerWidth, navigator.maxTouchPoints, /Mobile/.test(navigator.userAgent)]',
        '--json',
      ],
      0
    );
    assert.deepEqual(device.data?.['result'], [390, 5, true]);
    const reset = await expectEnvelope(['page', 'emulate', '--reset', '--json'], 0);
    assert.deepEqual(reset.data?.['emulated'], {});
    const desktop = await expectEnvelope(
      ['dom', 'eval', '[navigator.maxTouchPoints, /Mobile/.test(navigator.userAgent)]', '--json'],
      0
    );
    assert.deepEqual(desktop.data?.['result'], [0, false]);
    await expectEnvelope(['page', 'emulate', '--json'], 81);
    const interval = await expectEnvelope(['peek', '--interval', '500', '--json'], 81);
    assert.match(String(interval.suggestion), /--follow/);
  });

  void it('returns large results intact through a pipe', async () => {
    const result = await runCommand('dom', ['eval', "'x'.repeat(200000)", '--json', '--full'], {
      readDelay: 500,
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout) as Envelope;
    assert.equal((envelope.data?.['result'] as string).length, 200000);
  });

  void it('maps failures to semantic exit codes', async () => {
    await expectEnvelope(['dom', 'query', 'a[[', '--json'], 81);
    for (const args of [
      ['fill', 'a[[', 'x'],
      ['click', 'a[['],
      ['pressKey', 'a[[', 'Enter'],
      ['scroll', 'a[['],
      ['submit', 'a[['],
    ]) {
      await expectEnvelope(['dom', ...args, '--json'], 81);
    }
    await expectEnvelope(['dom', 'click', '#missing', '--json'], 83);
    await expectEnvelope(['details', 'network', 'missing', '--json'], 83);
    const running = await expectEnvelope([fixture.url, '--headless', '--json'], 84);
    assert.ok(running.data === undefined);
    const existing = (running as unknown as { existingSession?: Record<string, unknown> })
      .existingSession;
    assert.equal(typeof existing?.['durationMs'], 'number');
    assert.ok(!('errorCode' in running), 'internal error code is not printed');
    assert.match(String((running as unknown as { suggestion?: string }).suggestion), /bdg stop/);
  });

  void it('passes option-like values after -- untouched', async () => {
    await expectEnvelope(['dom', 'fill', '#second-input', '--json', '--', '--debug'], 0);
    const value = await expectEnvelope(
      ['dom', 'eval', "document.getElementById('second-input').value", '--json'],
      0
    );
    assert.equal(value.data?.['result'], '--debug');
  });

  /**
   * Follows until two envelopes (two refreshes, about 1 s apart) have been
   * printed, then stops it with Ctrl-C, instead of killing it after a fixed
   * time a slow runner may need just to start it.
   */
  void it('streams one whole envelope per line, without terminal codes, in follow mode', async () => {
    const ctrlC = new AbortController();
    const result = await runCommand('peek', ['-f', '--json'], {
      timeout: 30000,
      interrupt: ctrlC.signal,
      onStdout: (stdout) => {
        if (stdout.split('\n').length > 2) ctrlC.abort();
      },
    });
    assert.equal(result.exitCode, 130, result.stderr);
    assert.ok(!result.stdout.includes('\u001b'), 'no ANSI escape codes in JSON stream');
    const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
    assert.ok(lines.length >= 2, `stdout: ${result.stdout.slice(0, 200)}`);
    for (const line of lines) {
      assert.equal((JSON.parse(line) as { success: boolean }).success, true, line);
    }
  });

  void it('stops the session with a JSON result', async () => {
    await expectEnvelope(['stop', '--json'], 0);
  });
});
