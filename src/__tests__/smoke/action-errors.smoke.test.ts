/**
 * Action errors smoke test.
 *
 * The console errors and uncaught exceptions an action causes must be in its
 * result (JSON `errors` and `moreErrors`, human `Errors:` rows): a handler's
 * synchronous throw, a throw from a timer it set, an unhandled rejection,
 * `console.error`, and the errors of the page a click navigated to; for
 * click, fill, pressKey, submit, hover and scroll. Errors logged before the
 * action and warnings are left out. A fill fires the `InputEvent`s Chrome
 * does, so a listener reading `inputType` causes no error.
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
  warning?: string;
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

/**
 * The input events the fixture fields logged since the last call, then
 * cleared.
 *
 * @returns `id type InputEvent|Event inputType data` lines
 */
async function takeInputLog(): Promise<string[]> {
  const output = await bdg(['dom', 'eval', 'window.inputLog.splice(0)', '--json']);
  return (JSON.parse(output) as { data: { result: string[] } }).data.result;
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

  void it('fills text fields with InputEvents, so listeners reading inputType do not throw', async () => {
    const typed = await act(['fill', '#typed', 'flexbox']);
    assert.equal(typed.errors, undefined);
    assert.equal(typed.warning, undefined);
    assert.equal(errorTexts(await act(['fill', '#notes', 'line'])).length, 0);
    assert.equal(errorTexts(await act(['fill', '#editor', 'rich'])).length, 0);
    assert.equal(errorTexts(await act(['fill', '#typed', ''])).length, 0);
    assert.deepEqual(await takeInputLog(), [
      'typed beforeinput InputEvent insertText flexbox',
      'typed input InputEvent insertText flexbox',
      'notes beforeinput InputEvent insertText line',
      'notes input InputEvent insertText line',
      'editor beforeinput InputEvent insertText rich',
      'editor input InputEvent insertText rich',
      'typed beforeinput InputEvent deleteContentBackward ',
      'typed input InputEvent deleteContentBackward ',
    ]);
  });

  void it('keeps a plain input event for a date field', async () => {
    assert.equal(errorTexts(await act(['fill', '#when', '2024-01-05'])).length, 0);
    assert.deepEqual(await takeInputLog(), ['when input Event  ']);
  });

  void it('leaves a number field alone when it rejects the text, firing no events', async () => {
    const result = await runCommand('dom', ['fill', '#amount', 'abc', '--json'], {
      timeout: 60000,
    });
    assert.equal(result.exitCode, 81, result.stdout);
    assert.match((JSON.parse(result.stdout) as { error: string }).error, /rejected "abc"/);
    assert.deepEqual(await takeInputLog(), []);
    await bdg(['dom', 'fill', '#amount', '42']);
    assert.deepEqual(await takeInputLog(), [
      'amount beforeinput InputEvent insertText 42',
      'amount input InputEvent insertText 42',
    ]);
  });

  void it('fires nothing when filling "" into an empty field', async () => {
    await bdg(['dom', 'fill', '#amount', '']);
    await takeInputLog();
    await bdg(['dom', 'fill', '#amount', '']);
    await bdg(['dom', 'fill', '#editor', '']);
    await takeInputLog();
    await bdg(['dom', 'fill', '#editor', '']);
    assert.deepEqual(await takeInputLog(), []);
  });

  void it('updates a React-style controlled input through its value tracker', async () => {
    assert.equal(errorTexts(await act(['fill', '#controlled', 'Ada'])).length, 0);
    const shown = await bdg([
      'dom',
      'eval',
      '[document.getElementById("controlled").value, document.getElementById("controlled-state").textContent].join("|")',
    ]);
    assert.match(shown, /Ada\|Ada/);
  });

  void it('sets the value when the page cancels beforeinput, with a warning', async () => {
    const data = await act(['fill', '#rejecting', 'kept']);
    assert.match(data.warning ?? '', /The page cancelled beforeinput/);
    assert.equal(data.errors, undefined);
    assert.deepEqual(await takeInputLog(), [
      'rejecting beforeinput InputEvent insertText kept',
      'rejecting input InputEvent insertText kept',
    ]);
    assert.match(await bdg(['dom', 'eval', 'document.getElementById("rejecting").value']), /kept/);
  });

  void it('reports the errors of the page a click navigated to', async () => {
    const data = await act(['click', '#navigate']);
    assert.match(data.navigation?.url ?? '', /\/action-errors-target$/);
    assert.deepEqual(errorTexts(data), ['Uncaught Error: new page exploded']);
  });
});
