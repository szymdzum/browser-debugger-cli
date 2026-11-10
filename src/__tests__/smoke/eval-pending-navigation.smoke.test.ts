/**
 * An eval that gets no answer because a navigation waits for the server
 * names that navigation, not a busy script (#893).
 *
 * The hostile server's `/hang` reads a request and never answers. A page
 * starts a navigation to it with a link click, a form submit or a script
 * (`location.href=`); Chrome then holds the page's commands, and the next
 * eval times out. It must say the page waits for the server (exit 102) and
 * leave the page's scripts alone. A navigation bdg started (`page navigate`)
 * keeps the same message, and a script that really loops still gets the
 * busy-page error. The eval limit is shortened with `BDG_TEST_EVAL_TIMEOUT_MS`
 * (1 s, so each timeout test takes about 3 s); no test sleeps for a state:
 * the first eval after the navigation starts is the one that times out.
 */

import * as assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { startHostileServer, type HostileServer } from '@/__testutils__/hostileServer.js';

/** Upper bound for every command */
const COMMAND_TIMEOUT_MS = 60_000;

/** What the navigation-pending error says */
const WAITING_FOR_SERVER = /still waiting for the server to respond to .*\/hang/;

/** What the busy-page error says */
const SCRIPTS_TERMINATED = /scripts were terminated/;

/**
 * Run a bdg command with the long timeout.
 *
 * @param command - bdg subcommand
 * @param args - Arguments
 * @returns Result
 */
function bdg(command: string, args: string[] = []): Promise<CommandResult> {
  return runCommand(command, args, { timeout: COMMAND_TIMEOUT_MS });
}

/**
 * Assert that an eval failed with exit 102 naming the pending navigation.
 *
 * @param result - Result of `bdg eval`
 */
function assertNavigationBlamed(result: CommandResult): void {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.exitCode, 102, output);
  assert.match(output, WAITING_FOR_SERVER);
  assert.doesNotMatch(output, SCRIPTS_TERMINATED);
  assert.doesNotMatch(output, /a script kept it running/);
}

void describe('eval while a navigation waits for the server', () => {
  let hostile: HostileServer;
  let launch: string;

  before(async () => {
    process.env['BDG_TEST_EVAL_TIMEOUT_MS'] = '1000';
    process.env['BDG_TEST_EVAL_GRACE_MS'] = '1000';
    await cleanupAllSessions();
    hostile = await startHostileServer();
    launch = hostile.launchUrl(`${hostile.url}hang`);
    const port = await getFreePort();
    const started = await runCommand(launch, ['--port', String(port), '--headless'], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    assert.equal(started.exitCode, 0, started.stderr);
  });

  beforeEach(async () => {
    const result = await bdg('page', ['navigate', launch]);
    assert.equal(result.exitCode, 0, result.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await hostile.close();
  });

  void it('blames the navigation a link click started', async () => {
    const click = await bdg('dom', ['click', '#go']);
    assert.equal(click.exitCode, 0, click.stderr);
    assertNavigationBlamed(await bdg('eval', ['location.href']));
  });

  void it('blames the navigation a form submit started', async () => {
    const click = await bdg('dom', ['click', '#send']);
    assert.equal(click.exitCode, 0, click.stderr);
    assertNavigationBlamed(await bdg('eval', ['location.href']));
  });

  void it('blames the navigation a script started', async () => {
    await bdg('eval', ["location.href = '/hang'"]);
    assertNavigationBlamed(await bdg('eval', ['location.href']));
  });

  void it('keeps blaming a navigation bdg started', async () => {
    await bdg('page', ['navigate', `${hostile.url}hang`, '--no-wait']);
    assertNavigationBlamed(await bdg('eval', ['location.href']));
  });

  void it('shows the pending URL masked like every other URL', async () => {
    await bdg('page', ['navigate', `${hostile.url}hang?token=hunter2value`, '--no-wait']);
    const result = await bdg('eval', ['location.href']);
    assertNavigationBlamed(result);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /hunter2value/);
  });

  void it('still terminates a script that really keeps the page busy', async () => {
    await bdg('eval', ['setTimeout(() => { while (true); }, 0)']);
    const result = await bdg('eval', ['location.href']);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.exitCode, 102, output);
    assert.match(output, SCRIPTS_TERMINATED);
    assert.doesNotMatch(output, /still waiting for the server/);
  });
});
