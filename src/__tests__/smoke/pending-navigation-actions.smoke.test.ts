/**
 * Actions and `bdg stop` while a click-started navigation waits for the
 * server (#946).
 *
 * `/pending-nav` (see `pendingNavigationFixtures.ts`) has a link `#orders` to
 * a path the fixture server never answers. After `dom click '#orders'`,
 * Chrome holds every command for the page. Another action must then fail
 * with the navigation-pending error and exit 102 (not a bare
 * `Command timeout (30s)` with exit 81), in human and `--json` mode, and
 * `bdg stop` must cancel the pending load instead of waiting for the CDP
 * timeout. Nothing sleeps: the pending state is the click's own outcome.
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
import { isProcessAlive } from '@/utils/process.js';

/** Upper bound for every command */
const COMMAND_TIMEOUT_MS = 60_000;

/** The daemon's per-command timeout: failing before it is failing fast */
const DAEMON_COMMAND_TIMEOUT_MS = 30_000;

/** How long `bdg stop` may take with a pending navigation (was ~31 s) */
const STOP_LIMIT_MS = 10_000;

/** What the navigation-pending error says */
const WAITING_FOR_SERVER = /still waiting for the server to respond to .*\/authenticate-hanging/;

/** The JSON envelope of a failed command */
interface ErrorEnvelope {
  success: boolean;
  error: string;
  exitCode: number;
  suggestion?: string;
}

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
 * Run a bdg command and measure how long it took.
 *
 * @param command - bdg subcommand
 * @param args - Arguments
 * @returns Result and elapsed milliseconds
 */
async function timed(
  command: string,
  args: string[]
): Promise<{ result: CommandResult; elapsedMs: number }> {
  const startedAt = Date.now();
  const result = await bdg(command, args);
  return { result, elapsedMs: Date.now() - startedAt };
}

void describe('actions and stop while a click-started navigation waits for the server', () => {
  let fixture: FixtureServer;
  let chromePid: number | undefined;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await bdg(`${fixture.url}pending-nav`, ['--port', String(port), '--headless']);
    assert.equal(started.exitCode, 0, started.stderr);
    const status = await bdg('status', ['--json']);
    chromePid = (JSON.parse(status.stdout) as { data?: { chromePid?: number } }).data?.chromePid;
    const click = await bdg('dom', ['click', '#orders']);
    assert.equal(click.exitCode, 0, `${click.stdout}\n${click.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  const actions: Array<[string, string[]]> = [
    ['dom click', ['click', '#help']],
    ['dom hover', ['hover', '#help']],
    ['dom fill', ['fill', '#name', 'Ada']],
    ['dom press-key', ['press-key', '#name', 'Enter']],
  ];

  for (const [label, args] of actions) {
    void it(`${label} --json fails fast with the pending navigation and exit 102`, async () => {
      const { result, elapsedMs } = await timed('dom', [...args, '--json']);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.exitCode, 102, output);
      const envelope = JSON.parse(result.stdout) as ErrorEnvelope;
      assert.equal(envelope.success, false);
      assert.equal(envelope.exitCode, 102);
      assert.match(envelope.error, WAITING_FOR_SERVER);
      assert.ok(envelope.suggestion, `no suggestion: ${output}`);
      assert.ok(elapsedMs < DAEMON_COMMAND_TIMEOUT_MS, `took ${elapsedMs} ms`);
    });
  }

  void it('names the pending navigation in human mode too', async () => {
    const result = await bdg('dom', ['click', '#save']);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.exitCode, 102, output);
    assert.match(output, WAITING_FOR_SERVER);
    assert.doesNotMatch(output, /Command timeout/);
  });

  /**
   * Assert that the page is `/pending-nav` and answers an action.
   */
  async function assertPendingNavPageUsable(): Promise<void> {
    const where = await bdg('eval', ['location.pathname', '--json']);
    assert.equal(
      (JSON.parse(where.stdout) as { data: { result: string } }).data.result,
      '/pending-nav'
    );
    const click = await bdg('dom', ['click', '#save']);
    assert.equal(click.exitCode, 0, `${click.stdout}\n${click.stderr}`);
  }

  void it('page navigate after a held action cancels the pending navigation and loads', async () => {
    const { result, elapsedMs } = await timed('page', ['navigate', `${fixture.url}pending-nav`]);
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(elapsedMs < STOP_LIMIT_MS, `page navigate took ${elapsedMs} ms`);
    await assertPendingNavPageUsable();
  });

  void it('page reload after a held action cancels the pending navigation and reloads', async () => {
    const click = await bdg('dom', ['click', '#orders']);
    assert.equal(click.exitCode, 0, `${click.stdout}\n${click.stderr}`);
    const held = await bdg('dom', ['click', '#save']);
    assert.equal(held.exitCode, 102, `${held.stdout}\n${held.stderr}`);
    const { result, elapsedMs } = await timed('page', ['reload']);
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(elapsedMs < STOP_LIMIT_MS, `page reload took ${elapsedMs} ms`);
    await assertPendingNavPageUsable();
  });

  void it('dom wait outlasts the grace while a navigation answers after 8 s', async () => {
    const click = await bdg('dom', ['click', '#slow8']);
    assert.equal(click.exitCode, 0, `${click.stdout}\n${click.stderr}`);
    const wait = await bdg('dom', ['wait', '#test-button', '--timeout', '20000']);
    assert.equal(wait.exitCode, 0, `${wait.stdout}\n${wait.stderr}`);
    const back = await bdg('page', ['navigate', `${fixture.url}pending-nav`]);
    assert.equal(back.exitCode, 0, back.stderr);
  });

  void it('bdg stop cancels the pending navigation and returns within seconds', async () => {
    const click = await bdg('dom', ['click', '#orders']);
    assert.equal(click.exitCode, 0, `${click.stdout}\n${click.stderr}`);
    const { result, elapsedMs } = await timed('stop', []);
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(elapsedMs < STOP_LIMIT_MS, `bdg stop took ${elapsedMs} ms`);
    const status = await bdg('status', ['--json']);
    assert.doesNotMatch(status.stdout, /"active":\s*true/);
    if (chromePid !== undefined) assert.equal(isProcessAlive(chromePid), false, 'Chrome left');
  });
});
