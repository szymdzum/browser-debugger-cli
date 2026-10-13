/**
 * A CLI killed mid-call leaves no object group in the page (#606).
 *
 * `bdg dom query "*"` on a page with many elements is killed (SIGKILL, no
 * clean disconnect) while it holds its selection: once its `--debug` output
 * shows the fourth CDP call sent, the first one reading the selection, which
 * the query created with the third (a few hundred milliseconds on `/many`,
 * the CLI cannot release the selection before that call returns). The daemon cannot tell a killed CLI from a slow one while
 * nothing happens, so the test then runs another command, after which the
 * daemon's log must name the killed CLI's group as released. The log line is
 * the check, not the page's heap size: the release is deterministic, a heap
 * measurement after GC is not.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { getSessionDir } from '@/session/paths.js';

/** Long enough for a query of every element of `/many` */
const COMMAND_TIMEOUT_MS = 60000;

/** The CLI's `--debug` line for each CDP call it sends */
const CDP_CALL_SENT = /cdp_call request sent/g;

/** The CDP call of `dom query` that reads its selection */
const FIRST_SELECTION_READ = 4;

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: COMMAND_TIMEOUT_MS });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * The session's daemon log.
 *
 * @returns Its content
 */
function daemonLog(): string {
  return fs.readFileSync(path.join(getSessionDir(), 'daemon.log'), 'utf-8');
}

void describe('Object groups of a killed CLI (#606)', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}many`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('releases the group of a dom query killed mid-call', async () => {
    const kill = new AbortController();
    const query = await runCommand('dom', ['query', '*', '--json', '--debug'], {
      timeout: COMMAND_TIMEOUT_MS,
      interrupt: kill.signal,
      interruptWith: 'SIGKILL',
      onStderr: (stderr) => {
        if ((stderr.match(CDP_CALL_SENT)?.length ?? 0) >= FIRST_SELECTION_READ) kill.abort();
      },
    });
    assert.ok(kill.signal.aborted, `the query finished before it was killed: ${query.stderr}`);
    assert.equal(query.exitCode, 137, query.stderr);

    await bdg(['dom', 'query', 'title']);
    assert.match(
      daemonLog(),
      /Released object group bdg-query-\d+-\d+ of exited bdg process \d+/,
      'the killed query left its object group in the page'
    );
  });
});
