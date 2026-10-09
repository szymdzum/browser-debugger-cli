/**
 * Action errors smoke test.
 *
 * The console errors and uncaught exceptions an action causes must be in its
 * result (JSON `errors` and `moreErrors`, human `Errors:` rows): a handler's
 * synchronous throw, a throw from a timer it set, an unhandled rejection,
 * `console.error`, and the errors of the page a click navigated to; for
 * click, fill, pressKey, submit, hover and scroll. Errors logged before the
 * action and warnings are left out.
 *
 * Timing: the timer's throw (`setTimeout(…, 0)`) runs before the action's
 * result is read, whatever the runner's speed. The click waits at least
 * 150 ms for the network to be idle, and the read after it first lets every
 * timer that fell due run (bdg's own 0 ms timer, queued after the page's).
 * The scroll event fires at the next frame, within that 150 ms wait. The
 * navigated page throws in its first inline script, which runs as its
 * document is parsed, before the click's 150 ms idle wait after that
 * document arrived ends.
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

/** An error as an action's `--json` reports it */
interface ReportedError {
  text: string;
  source?: string;
  count: number;
}

/** The part of an action result this test reads */
interface ActionData {
  errors?: ReportedError[];
  moreErrors?: number;
  navigation?: { url: string };
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Standard output
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * Run a DOM action with `--json` and return its result.
 *
 * @param args - Arguments after `dom`
 * @returns Result data
 */
async function act(args: string[]): Promise<ActionData> {
  return (JSON.parse(await bdg(['dom', ...args, '--json'])) as { data: ActionData }).data;
}

/**
 * Texts of the reported errors.
 *
 * @param data - Action result
 * @returns Texts, in the order reported
 */
function errorTexts(data: ActionData): string[] {
  return (data.errors ?? []).map((error) => error.text);
}

void describe('Errors an action caused', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}action-errors`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports nothing for an action without errors, leaving out the page load', async () => {
    const data = await act(['click', '#quiet']);
    assert.equal(data.errors, undefined);
    assert.equal(data.moreErrors, undefined);
  });

  void it('reports a synchronous throw with its source', async () => {
    const data = await act(['click', '#sync']);
    assert.deepEqual(errorTexts(data), ['Uncaught Error: sync exploded']);
    assert.match(data.errors?.[0]?.source ?? '', /\/action-errors:\d+:\d+$/);
    assert.equal(data.errors?.[0]?.count, 1);
  });

  void it('reports a throw from a timer the handler set', async () => {
    assert.deepEqual(errorTexts(await act(['click', '#async'])), [
      'Uncaught Error: async exploded',
    ]);
  });

  void it('reports an unhandled rejection', async () => {
    assert.deepEqual(errorTexts(await act(['click', '#rejection'])), [
      'Uncaught (in promise) Error: rejected in handler',
    ]);
  });

  void it('reports console.error once with its count, leaving warnings out', async () => {
    const data = await act(['click', '#logged']);
    assert.deepEqual(data.errors, [
      { text: 'logged boom', source: data.errors?.[0]?.source, count: 2 },
    ]);
  });

  void it('lists 3 distinct errors and counts the rest', async () => {
    const data = await act(['click', '#many']);
    assert.deepEqual(errorTexts(data), ['first error', 'second error', 'third error']);
    assert.equal(data.moreErrors, 1);
  });

  void it('prints the errors and the hint for the rest in human output', async () => {
    const output = await bdg(['dom', 'click', '#many']);
    assert.match(output, /^Errors: +first error \(action-errors:\d+:\d+\)$/m);
    assert.match(output, /^ +\+1 more \(bdg console --level error\)$/m);
    const sync = await bdg(['dom', 'click', '#sync']);
    assert.match(sync, /^Errors: +Uncaught Error: sync exploded \(action-errors:\d+:\d+\)$/m);
  });

  void it('reports errors of fill, pressKey, hover, submit and scroll', async () => {
    assert.deepEqual(errorTexts(await act(['fill', '#field', 'x'])), [
      'Uncaught Error: input exploded',
    ]);
    assert.deepEqual(errorTexts(await act(['pressKey', '#field', 'Enter'])), [
      'Uncaught Error: key exploded',
    ]);
    assert.deepEqual(errorTexts(await act(['hover', '#hover-box'])), [
      'Uncaught Error: hover exploded',
    ]);
    assert.deepEqual(errorTexts(await act(['submit', '#form'])), [
      'Uncaught Error: submit exploded',
    ]);
    assert.deepEqual(errorTexts(await act(['scroll', '--down', '500'])), [
      'Uncaught Error: scroll exploded',
    ]);
  });

  void it('reports the errors of the page a click navigated to', async () => {
    const data = await act(['click', '#navigate']);
    assert.match(data.navigation?.url ?? '', /\/action-errors-target$/);
    assert.deepEqual(errorTexts(data), ['Uncaught Error: new page exploded']);
  });
});
