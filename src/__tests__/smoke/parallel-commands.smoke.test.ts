/**
 * Concurrent commands smoke test (#584).
 *
 * Commands run in parallel on one session share its page connection; each
 * releases only the page objects it created, so none fails or reads wrong
 * because another one finished first.
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

/** Rounds of parallel commands; the race showed in most rounds before the fix */
const ROUNDS = 10;

/** Result of one command */
interface Run {
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a bdg command.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Its exit code and output
 */
async function run(args: string[]): Promise<Run> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  return { args, ...result };
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list
 * @returns Stdout
 */
async function bdg(args: string[]): Promise<string> {
  const result = await run(args);
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * The failures among commands run together.
 *
 * @param commands - Argument lists of the commands
 * @returns `bdg <args>: <exit code> <stderr>` for each one that failed
 */
async function parallelFailures(commands: string[][]): Promise<string[]> {
  const runs = await Promise.all(commands.map(run));
  return runs
    .filter((result) => result.exitCode !== 0)
    .map((result) => `bdg ${result.args.join(' ')}: ${result.exitCode} ${result.stderr.trim()}`);
}

void describe('Concurrent commands', () => {
  let fixture: FixtureServer;
  let textboxIds: number[];

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}shadow-forms`, '--port', String(port), '--headless']);
    const textboxes = JSON.parse(await bdg(['dom', 'a11y', 'query', 'role=textbox', '--json'])) as {
      data: { nodes: Array<{ backendDOMNodeId?: number }> };
    };
    textboxIds = textboxes.data.nodes.flatMap((node) => node.backendDOMNodeId ?? []);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reads every node id of parallel dom get --node-id calls (#584)', async () => {
    assert.ok(textboxIds.length >= 7, `textboxes: ${textboxIds.join(', ')}`);
    for (let round = 1; round <= ROUNDS; round++) {
      const failures = await parallelFailures(
        textboxIds.map((id) => ['dom', 'get', '--node-id', String(id)])
      );
      assert.deepEqual(failures, [], `round ${round}`);
    }
  });
});
