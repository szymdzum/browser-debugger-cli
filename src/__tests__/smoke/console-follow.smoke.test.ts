/**
 * `console --follow` keeps the messages of a page left between two polls.
 *
 * The errors a page logs as it navigates away are the left page's: the stream prints them, then the navigation
 * separator, then the new page's lines, each once. `--level` applies to them
 * too.
 *
 * Timing: nothing waits a fixed time. The test waits for the stream to print
 * its first line, then for the new page's line. The fixture's click logs and
 * navigates in one task, so a poll can hardly fall between the two; if one
 * does, the output is the same.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
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

/**
 * Follow the console while `act` runs, until the stream's stdout satisfies
 * `done`; then interrupt it.
 *
 * @param args - `console` arguments
 * @param act - Commands to run once the stream has started
 * @param done - Whether stdout has everything expected
 * @returns The stream's result
 */
async function followDuring(
  args: string[],
  act: () => Promise<void>,
  done: (stdout: string) => boolean
): Promise<CommandResult> {
  const stop = new AbortController();
  let started: () => void = () => undefined;
  const hasStarted = new Promise<void>((resolve) => (started = resolve));
  const stream = runCommand('console', ['--follow', ...args], {
    timeout: COMMAND_TIMEOUT_MS,
    interrupt: stop.signal,
    onStdout: (stdout) => {
      started();
      if (done(stdout)) stop.abort();
    },
  });
  await hasStarted;
  await act();
  return stream;
}

void describe('console --follow across a navigation', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}follow-left`,
      ['--port', String(port), '--headless'],
      { timeout: COMMAND_TIMEOUT_MS }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  const leave = async (): Promise<void> => {
    await bdg('dom', ['click', '#leave']);
  };
  const arrived = (stdout: string): boolean => stdout.includes('arrived error');

  void it('prints the left page errors, the separator, then the new page lines, once each', async () => {
    await bdg('page', ['navigate', `${fixture.url}follow-left`]);
    const result = await followDuring([], leave, arrived);
    const lines = result.stdout.split('\n');
    for (const text of ['first error', 'second error', 'third error', 'fourth error']) {
      assert.equal(lines.filter((line) => line.endsWith(text)).length, 1, result.stdout);
    }
    assert.equal(lines.filter((line) => line.includes('Next page')).length, 1, result.stdout);
    assert.match(result.stdout, /fourth error[\s\S]*Next page[\s\S]*arrived error/);
  });

  void it('prints them in --json lines, and applies --level to them', async () => {
    await bdg('page', ['navigate', `${fixture.url}follow-left`]);
    const result = await followDuring(['--json', '--level', 'error'], leave, (stdout) =>
      arrived(stdout)
    );
    const texts = result.stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        const data = (JSON.parse(line) as { data: { messages?: Array<{ text: string }> } }).data;
        return (data.messages ?? []).map((message) => message.text);
      });
    const many = texts.filter((text) => text.endsWith(' error') && !text.startsWith('arrived'));
    assert.deepEqual(many.slice(-4), [
      'first error',
      'second error',
      'third error',
      'fourth error',
    ]);
    assert.ok(texts.includes('arrived error'), texts.join('|'));
    assert.ok(!texts.includes('left warning'), texts.join('|'));
    assert.ok(!texts.includes('arrived warning'), texts.join('|'));
  });
});
