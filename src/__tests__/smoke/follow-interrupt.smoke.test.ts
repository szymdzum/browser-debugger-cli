/**
 * Follow modes end on Ctrl-C and SIGTERM with their stop line (#704).
 *
 * `dom screenshot --follow`, `console --follow` and `peek --follow` stop
 * after the current step, say so on stderr and exit 130 (143 for SIGTERM).
 * No `Interrupted` envelope is printed: each NDJSON line is already a whole
 * envelope. A `--limit` that is reached ends with 0.
 *
 * The signal is sent once the stream has printed its first line (waiting on
 * output, no fixed sleeps).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { ensureTestSessionDir } from '@/__testutils__/testHome.js';

/** Long enough for a slow runner to start Chrome and capture a frame */
const COMMAND_TIMEOUT_MS = 60000;

/** A frame interval long enough that a stop must not wait for the next frame */
const LONG_INTERVAL_MS = '60000';

after(removeTempDirs);

/**
 * Run a follow command and send `signal` once `ready` says its output has
 * the first line.
 *
 * @param command - Command name
 * @param args - Command arguments
 * @param signal - Signal to send
 * @param ready - Whether the output so far has the first line
 * @returns The command's result
 */
async function followThenSignal(
  command: string,
  args: string[],
  signal: NodeJS.Signals,
  ready: (output: string) => boolean
): Promise<CommandResult> {
  const stop = new AbortController();
  let output = { stdout: '', stderr: '' };
  const check = (): void => {
    if (ready(`${output.stdout}${output.stderr}`)) stop.abort();
  };
  return runCommand(command, args, {
    timeout: COMMAND_TIMEOUT_MS,
    interrupt: stop.signal,
    interruptWith: signal,
    onStdout: (stdout) => {
      output = { ...output, stdout };
      check();
    },
    onStderr: (stderr) => {
      output = { ...output, stderr };
      check();
    },
  });
}

/**
 * Assert that every stdout line is a whole success envelope, none an
 * `Interrupted` one.
 *
 * @param result - The command's result
 * @returns The envelopes
 */
function ndjsonEnvelopes(result: CommandResult): Array<Record<string, unknown>> {
  const lines = result.stdout.split('\n').filter((line) => line.trim() !== '');
  assert.ok(lines.length >= 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return lines.map((line) => {
    const envelope = JSON.parse(line) as Record<string, unknown>;
    assert.equal(envelope['success'], true, line);
    assert.notEqual(envelope['error'], 'Interrupted', line);
    return envelope;
  });
}

void describe('Follow modes and interrupts', () => {
  let fixture: FixtureServer;

  before(async () => {
    ensureTestSessionDir();
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const start = await runCommand(fixture.url, ['--port', String(port), '--headless'], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    assert.equal(start.exitCode, 0, `${start.stdout}${start.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  const firstFrame = (output: string): boolean => /"frame":\s*1\b/.test(output);

  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    void it(`dom screenshot --follow stops on ${signal} with exit ${exitCode} and its stop line`, async () => {
      const dir = makeTempDir('bdg-follow-');
      const started = Date.now();
      const result = await followThenSignal(
        'dom',
        ['screenshot', dir, '--follow', '--interval', LONG_INTERVAL_MS, '--json'],
        signal,
        firstFrame
      );
      assert.equal(result.exitCode, exitCode, `${result.stdout}\n${result.stderr}`);
      assert.ok(
        Date.now() - started < Number(LONG_INTERVAL_MS) / 2,
        'the stop did not wait for the inter-frame delay'
      );
      const frames = ndjsonEnvelopes(result);
      assert.match(result.stderr, new RegExp(`Captured ${frames.length} frames?\\b`));
      assert.equal(fs.readdirSync(dir).length, frames.length);
      const first = frames[0]?.['data'] as { frame?: number; path?: string };
      assert.equal(first.frame, 1);
      assert.ok(fs.existsSync(path.resolve(first.path ?? '')));
    });
  }

  void it('dom screenshot --follow --limit reached ends with exit 0', async () => {
    const dir = makeTempDir('bdg-follow-');
    const result = await runCommand(
      'dom',
      ['screenshot', dir, '--follow', '--interval', '100', '--limit', '2', '--json'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(ndjsonEnvelopes(result).length, 2);
    assert.match(result.stderr, /Captured 2 frames/);
  });

  for (const [command, args, stopLine] of [
    ['console', ['--follow'], /Stopped streaming console messages/],
    ['peek', ['--follow'], /Stopped following preview/],
  ] as const) {
    for (const [signal, exitCode] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      void it(`${command} --follow stops on ${signal} with exit ${exitCode} and its stop line`, async () => {
        const result = await followThenSignal(command, [...args, '--json'], signal, (output) =>
          output.includes('{')
        );
        assert.equal(result.exitCode, exitCode, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, stopLine);
        assert.ok(!result.stdout.includes('"Interrupted"'), result.stdout);
      });
    }
  }
});
