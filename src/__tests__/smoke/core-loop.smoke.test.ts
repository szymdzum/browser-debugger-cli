/**
 * Core agent loop smoke test.
 *
 * Exercises the path agents rely on most, end to end against a real Chrome:
 * start → dom query → fill/click by index → console → network → status → stop.
 * Uses a local fixture server, so no internet access is needed.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import {
  cleanupAllSessions,
  isDaemonRunning,
  readTestChromePid,
  waitForProcessExit,
} from '@/__testutils__/daemonHelpers.js';
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
  const envelope = JSON.parse(result.stdout) as { success: boolean; data: T };
  assert.equal(envelope.success, true);
  return envelope.data;
}

/**
 * Evaluate an expression in the page and return its value.
 *
 * @param expression - JavaScript expression
 * @returns Evaluated value
 */
async function evaluate(expression: string): Promise<unknown> {
  const data = await runJson<{ result: unknown }>('dom', ['eval', expression]);
  return data.result;
}

void describe('Core agent loop', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('starts a session against the fixture page', async () => {
    const port = await getFreePort();
    const result = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    assert.equal(await isDaemonRunning(), true);
  });

  void it('queries elements and fills one by 0-based index', async () => {
    const query = await runJson<{ count: number }>('dom', ['query', 'input']);
    assert.equal(query.count, 2);

    const fill = await runCommand('dom', ['fill', '1', 'hello'], { timeout: 30000 });
    assert.equal(fill.exitCode, 0, `Fill failed: ${fill.stderr}`);

    assert.equal(await evaluate("document.getElementById('second-input').value"), 'hello');
    assert.equal(await evaluate("document.getElementById('test-input').value"), 'test value');
  });

  void it('clicks an element with text content by index', async () => {
    await runJson('dom', ['query', 'button']);
    const click = await runCommand('dom', ['click', '1'], { timeout: 30000 });
    assert.equal(click.exitCode, 0, `Click failed: ${click.stderr}`);

    const console = await runJson<{ messages: Array<{ text: string }> }>('console', ['--list']);
    const texts = console.messages.map((m) => m.text);
    assert.ok(texts.includes('Second button clicked'), `Console was: ${texts.join(' | ')}`);
    assert.ok(!texts.includes('Button clicked'), 'Index 1 must not click the first button');
  });

  void it('captures network requests made by the page', async () => {
    const data = await runJson<{ requests: Array<{ url: string }> }>('network', ['list']);
    assert.ok(
      data.requests.some((r) => r.url.endsWith('/api/test')),
      `Requests were: ${data.requests.map((r) => r.url).join(', ')}`
    );
  });

  void it('reports an active session in status', async () => {
    const result = await runCommand('status', ['--json'], { timeout: 15000 });
    assert.equal(result.exitCode, 0, `Status failed: ${result.stderr}`);
    const status = JSON.parse(result.stdout) as { success: boolean; data: { active: boolean } };
    assert.equal(status.data.active, true);
  });

  void it('stops the session and leaves nothing running', async () => {
    const chromePid = readTestChromePid();
    assert.ok(chromePid, 'Chrome PID should be recorded in session metadata');

    const result = await runCommand('stop', ['--kill-chrome'], { timeout: 30000 });
    assert.equal(result.exitCode, 0, `Stop failed: ${result.stderr}`);

    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome should exit after stop');
    assert.equal(await isDaemonRunning(), false);
  });
});
