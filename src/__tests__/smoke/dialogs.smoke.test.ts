/**
 * JavaScript dialogs smoke test (#450).
 *
 * The session starts (after a mistyped `--dialog` is refused with 81) with
 * `--dialog dismiss` on `/dialogs-load`, whose
 * confirm while loading is dismissed; the `/dialogs` actions then answer
 * with `--dialog` and `--prompt-text`, which reset after the action, and a
 * beforeunload dialog is accepted unless the action itself dismisses it.
 *
 * Timing: none of this waits for a timer. Each dialog opens synchronously in
 * the handler of the event the action dispatches (or the page's own script
 * while it loads), and bdg answers it from the `Page.javascriptDialogOpening`
 * event before the action returns.
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

/** A dialog as `--json` results list it */
interface DialogJson {
  type: string;
  message: string;
  answer: string;
  promptText?: string;
}

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @param expectedExit - Expected process exit code
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[], expectedExit = 0): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, expectedExit, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Evaluate an expression in the page and return its result.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  const output = await bdg(['dom', 'eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

/**
 * Run an action with `--json` and return the dialogs it reports.
 *
 * @param args - Action arguments after `dom`
 * @returns Its dialogs
 */
async function dialogsOf(args: string[]): Promise<DialogJson[] | undefined> {
  const output = await bdg(['dom', ...args, '--json']);
  return (JSON.parse(output) as { data: { dialogs?: DialogJson[] } }).data.dialogs;
}

void describe('JavaScript dialogs', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const start = [`${fixture.url}dialogs-load`, '--port', String(port), '--headless', '--dialog'];
    assert.match(await bdg([...start, 'dismis'], 81), /Did you mean: dismiss\?/);
    await bdg([...start, 'dismiss']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('applies the session default to a dialog during page load', async () => {
    assert.equal(await evaluate('window.loaded'), false);
    await bdg(['page', 'navigate', `${fixture.url}dialogs`]);
  });

  void it('answers with the action choice, then the session default again', async () => {
    assert.deepEqual(await dialogsOf(['click', '#conf']), [
      { type: 'confirm', message: 'Sure?', answer: 'dismissed' },
    ]);
    assert.equal(await evaluate('window.confirmed'), false);

    assert.deepEqual(await dialogsOf(['click', '#conf', '--dialog', 'accept']), [
      { type: 'confirm', message: 'Sure?', answer: 'accepted' },
    ]);
    assert.equal(await evaluate('window.confirmed'), true);

    assert.match(await bdg(['dom', 'click', '#conf']), /Dialog: confirm\(\) dismissed: "Sure\?"/);
    assert.equal(await evaluate('window.confirmed'), false, 'the action choice was reset');

    await bdg(['dom', 'pressKey', '#key', 'a', '--dialog', 'accept']);
    assert.equal(await evaluate('window.keyConfirmed'), true);
  });

  void it('gives the page the prompt text', async () => {
    assert.deepEqual(await dialogsOf(['click', '#ask', '--prompt-text', 'hello']), [
      { type: 'prompt', message: 'Name?', answer: 'accepted', promptText: 'hello' },
    ]);
    assert.equal(await evaluate('window.answered'), 'hello');
    assert.match(
      await bdg(['dom', 'click', '#note', '--dialog', 'accept']),
      /Dialog: alert\(\) accepted: "Saved"/
    );
  });

  void it('lets the page unload unless the action dismisses beforeunload', async () => {
    await evaluate('window.guard = true');
    assert.deepEqual(await dialogsOf(['click', '#leave', '--dialog', 'dismiss']), [
      { type: 'beforeunload', message: '', answer: 'dismissed' },
    ]);
    assert.equal(await evaluate('location.pathname'), '/dialogs');

    await bdg(['dom', 'click', '#leave']);
    await bdg(['dom', 'wait', '#loaded']);
    assert.equal(await evaluate('location.pathname'), '/dialogs-load');
    assert.equal(await evaluate('window.loaded'), false, 'the new page got the session default');
  });

  void it('refuses an unknown answer with 81 and a suggestion', async () => {
    assert.match(
      await bdg(['dom', 'click', '#leave', '--dialog', 'dimiss'], 81),
      /Did you mean: dismiss\?/
    );
    const envelope = JSON.parse(
      await bdg(['dom', 'click', '#leave', '--dialog', 'nope', '--json'], 81)
    ) as { exitCode: number; suggestion: string };
    assert.equal(envelope.exitCode, 81);
    assert.match(envelope.suggestion, /accept, dismiss/);
    assert.equal(await evaluate('location.pathname'), '/dialogs-load', 'nothing was clicked');
  });
});
