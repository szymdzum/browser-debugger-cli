/**
 * `console --follow --ndjson` streams one JSON object per line: a `page`
 * record per page, in order (also for a page that logged nothing), and a
 * `message` record per console message; `--ndjson` needs `--follow` and
 * excludes `--json`.
 *
 * Timing: nothing waits a fixed time. The test waits for the stream's first
 * line, acts, then waits for the last expected message line before it
 * interrupts the stream.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

const COMMAND_TIMEOUT_MS = 60000;

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param command - Command name
 * @param args - Arguments
 */
async function bdg(command: string, args: string[]): Promise<void> {
  const result = await runCommand(command, args, { timeout: COMMAND_TIMEOUT_MS });
  assert.equal(
    result.exitCode,
    0,
    `bdg ${command} ${args.join(' ')}: ${result.stdout}${result.stderr}`
  );
}

interface StreamRecord {
  type: string;
  navigationId?: number;
  url?: string;
  text?: string;
}

/**
 * Follow `console --ndjson` while `act` runs, until a line has `lastText`.
 *
 * @param args - Extra `console` arguments
 * @param act - Commands to run once the stream has started
 * @param lastText - Text of the message that ends the test
 * @returns Stdout and its records
 */
async function ndjsonDuring(
  args: string[],
  act: () => Promise<void>,
  lastText: string
): Promise<{ stdout: string; records: StreamRecord[] }> {
  const stop = new AbortController();
  let started: () => void = () => undefined;
  const hasStarted = new Promise<void>((resolve) => (started = resolve));
  const stream = runCommand('console', ['--follow', '--ndjson', ...args], {
    timeout: COMMAND_TIMEOUT_MS,
    interrupt: stop.signal,
    onStdout: (stdout) => {
      started();
      if (stdout.includes(`"${lastText}"`)) stop.abort();
    },
  });
  await Promise.race([hasStarted, stream]);
  await act();
  const result = await stream;
  const lines = result.stdout.split('\n');
  assert.ok(
    lines.every((line) => line.trim() !== '' || line === lines.at(-1)),
    result.stdout
  );
  const records = lines
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as StreamRecord);
  return { stdout: result.stdout, records };
}

void describe('console --follow --ndjson', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}ndjson-start`,
      ['--port', String(port), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('streams page records in order, also for a page that logged nothing', async () => {
    await bdg('page', ['navigate', `${fixture.url}ndjson-start`]);
    const { stdout, records } = await ndjsonDuring(
      [],
      async () => {
        await bdg('dom', ['click', '#go']);
        await bdg('dom', ['click', '#next']);
      },
      'end message'
    );
    const shape = records.map((r) =>
      r.type === 'page' ? `page ${r.url?.split('/').pop()}` : r.text
    );
    assert.deepEqual(shape.slice(0, 2), ['page ndjson-start', 'start message'], stdout);
    assert.deepEqual(
      shape.slice(2).map((s) => s?.replace(/\?.*/, '')),
      ['page ndjson-quiet', 'page ndjson-end', 'end message'],
      stdout
    );
    const ids = records.filter((r) => r.type === 'page').map((r) => r.navigationId ?? -1);
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      ids,
      stdout
    );
    assert.equal(new Set(ids).size, 3, stdout);
    assert.doesNotMatch(stdout, /hunter2secret/);
    assert.ok(
      records.every((r) => r.type === 'page' || r.type === 'message'),
      stdout
    );
  });

  void it('needs --follow, and cannot be combined with --json', async () => {
    const alone = await runCommand('console', ['--ndjson', '--json'], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    assert.equal(alone.exitCode, 81, alone.stdout);
    const envelope = JSON.parse(alone.stdout) as { success: boolean; suggestion?: string };
    assert.equal(envelope.success, false);
    const plain = await runCommand('console', ['--ndjson'], { timeout: COMMAND_TIMEOUT_MS });
    assert.equal(plain.exitCode, 81, plain.stderr);
    assert.match(plain.stderr, /--follow/);
    const both = await runCommand('console', ['--follow', '--ndjson', '--json'], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    assert.equal(both.exitCode, 81, both.stdout);
    assert.equal((JSON.parse(both.stdout) as { success: boolean }).success, false);
  });
});
