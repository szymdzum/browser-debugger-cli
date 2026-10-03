/**
 * JSON contract smoke test.
 *
 * Every `--json` invocation must print exactly one response envelope:
 * `{ version, success: true, data }` or `{ version, success: false, error, exitCode }`,
 * with `exitCode` equal to the process exit code and no envelope fields nested
 * inside `data`. Covers success and failure paths with and without a session.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions, isDaemonRunning } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

interface Envelope {
  version: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  exitCode?: number;
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
    ]) {
      await expectEnvelope(args, 81);
    }
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
    assert.ok(!('version' in (status.data ?? {})), 'status: version only in the envelope');

    await expectEnvelope(['console', '--list', '--json'], 0);
    await expectEnvelope(['dom', 'query', 'button', '--json'], 0);
    await expectEnvelope(['dom', 'a11y', 'tree', '--json'], 0);
    await expectEnvelope(['dom', 'eval', '1+1', '--json'], 0);
  });

  void it('maps failures to semantic exit codes', async () => {
    await expectEnvelope(['dom', 'query', 'a[[', '--json'], 81);
    await expectEnvelope(['dom', 'click', '#missing', '--json'], 83);
    await expectEnvelope(['details', 'network', 'missing', '--json'], 83);
    const running = await expectEnvelope([fixture.url, '--headless', '--json'], 84);
    assert.ok(running.data === undefined);
    assert.equal(
      typeof (running as unknown as { existingSession?: unknown }).existingSession,
      'object'
    );
  });

  void it('passes option-like values after -- untouched', async () => {
    await expectEnvelope(['dom', 'fill', '#second-input', '--json', '--', '--debug'], 0);
    const value = await expectEnvelope(
      ['dom', 'eval', "document.getElementById('second-input').value", '--json'],
      0
    );
    assert.equal(value.data?.['result'], '--debug');
  });

  void it('streams whole envelopes without terminal codes in follow mode', async () => {
    const result = await runCommand('peek', ['-f', '--json'], { timeout: 2500 });
    assert.ok(result.stdout.trimStart().startsWith('{'), `stdout: ${result.stdout.slice(0, 200)}`);
    assert.ok(!result.stdout.includes('\u001b'), 'no ANSI escape codes in JSON stream');
    assert.match(result.stdout, /"success": true/);
  });

  void it('stops the session with a JSON result', async () => {
    await expectEnvelope(['stop', '--json'], 0);
  });
});
