/**
 * Pre-rendered dialog smoke test (#786).
 *
 * A click (or Enter) that opens a `<dialog>` already in the DOM (`showModal()`
 * or the `open` attribute, in the light DOM or an open shadow root) lists it
 * under `Shown:` (`shown` in `--json`). Dialogs the page opens on its own, a
 * click that closes one, a dialog open from the start, a popover and a
 * `<details>` toggle list no dialog. The timer case is deterministic: the
 * page reopens a dialog every 20 ms and counts it in `window.dialogTicks`, and
 * the test asserts the count rose while the action ran.
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

/** The part of an action result this test reads */
interface ActionData {
  shown?: { text: string; element: string }[];
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
 * @param action - `click` or `pressKey`
 * @param args - Selector (and key)
 * @returns Result data
 */
async function act(action: string, ...args: string[]): Promise<ActionData> {
  const out = await bdg(['dom', action, ...args, '--json']);
  return (JSON.parse(out) as { data: ActionData }).data;
}

/**
 * Start a session on a fixture page.
 *
 * @param url - Page URL
 */
async function open(url: string): Promise<void> {
  await cleanupAllSessions();
  const port = await getFreePort();
  const started = await runCommand(url, ['--port', String(port), '--headless'], {
    timeout: 60000,
  });
  assert.equal(started.exitCode, 0, started.stderr);
}

/**
 * Evaluate a page expression.
 *
 * @param expression - JavaScript expression
 * @returns Its value
 */
async function evaluate(expression: string): Promise<number> {
  const out = await bdg([
    'cdp',
    'Runtime.evaluate',
    '--params',
    JSON.stringify({ expression, awaitPromise: true, returnByValue: true }),
  ]);
  return (JSON.parse(out) as { result: { value: number } }).result.value;
}

/**
 * Assert that the result lists a dialog with the text.
 *
 * @param data - Action result
 * @param text - Text the dialog shows
 */
function assertDialogShown(data: ActionData, text: string): void {
  const entry = (data.shown ?? []).find((item) => item.text === text);
  assert.ok(
    entry?.element.startsWith('dialog'),
    `shown names dialog "${text}": ${JSON.stringify(data)}`
  );
}

/**
 * Assert that the result lists no dialog.
 *
 * @param data - Action result
 */
function assertNoDialog(data: ActionData): void {
  const dialogs = (data.shown ?? []).filter((item) => item.element.startsWith('dialog'));
  assert.deepEqual(dialogs, [], JSON.stringify(data));
}

void describe('Pre-rendered dialogs in action results (#786)', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  const cases: [string, string][] = [
    ['modal', 'Modal opened'],
    ['attr', 'Attribute opened'],
    ['shadow', 'Shadow opened'],
    ['fade', 'Fade opened'],
  ];
  for (const [id, text] of cases) {
    void it(`click #${id} lists dialog "${text}" (--json)`, async () => {
      await open(`${fixture.url}dialog-open`);
      assertDialogShown(await act('click', `#${id}`), text);
    });
  }

  void it('human output has a Shown row naming the dialog', async () => {
    await open(`${fixture.url}dialog-open`);
    assert.match(await bdg(['dom', 'click', '#modal']), /\nShown: +dialog\S* "Modal opened"\n/);
  });

  void it('pressKey Enter on a button that opens a dialog lists it', async () => {
    await open(`${fixture.url}dialog-open`);
    assertDialogShown(await act('press-key', '#key', 'Enter'), 'Key opened');
  });

  void it('a dialog with only a password field is not listed', async () => {
    await open(`${fixture.url}dialog-open`);
    assertNoDialog(await act('click', '#secret'));
  });

  void it('a dialog the page keeps reopening on a timer is not listed', async () => {
    await open(`${fixture.url}dialog-quiet`);
    await evaluate(
      'new Promise((resolve) => { const check = () => (window.dialogTicks >= 3 ? resolve(1) : setTimeout(check, 10)); check(); })'
    );
    const before = await evaluate('window.dialogTicks');
    const data = await act('click', '#noop');
    assert.ok(
      (await evaluate('window.dialogTicks')) > before,
      'the page reopened the dialog meanwhile'
    );
    assertNoDialog(data);
  });

  void it('a closed dialog the page opens by itself after the press is not listed', async () => {
    await open(`${fixture.url}dialog-quiet`);
    assert.equal(await evaluate('window.lateOpened === null ? 1 : 0'), 1);
    const data = await act('click', '#late');
    assert.equal(
      await evaluate('document.getElementById("late-dialog").open ? 1 : 0'),
      1,
      'opened'
    );
    assert.equal(
      await evaluate('window.lateOpened > window.pressedAt ? 1 : 0'),
      1,
      'after the press'
    );
    assertNoDialog(data);
  });

  void it('a dialog the page closed earlier in the watch and the click reopened is not listed', async () => {
    await open(`${fixture.url}dialog-quiet`);
    const data = await act('click', '#reopen');
    assert.equal(
      await evaluate('document.getElementById("reopen-dialog").open ? 1 : 0'),
      1,
      'reopened'
    );
    assertNoDialog(data);
  });

  for (const id of ['close', 'pop', 'sum']) {
    void it(`click #${id} lists no dialog`, async () => {
      await open(`${fixture.url}dialog-quiet`);
      assertNoDialog(await act('click', `#${id}`));
    });
  }
});
