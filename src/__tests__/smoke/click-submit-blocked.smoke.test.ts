/**
 * Blocked submit smoke test (#572).
 *
 * A `dom click` on a submit button whose form fails constraint validation
 * names the fields that blocked it, the way `dom submit` does
 * (`Submit blocked: email: Please include an '@' …`, JSON `submitBlocked`),
 * from the first click on, and still exits 0: on `/shadow-forms` (a form in
 * an open shadow root) and on `/submit-blocked`, for a form in a closed
 * shadow root and a submit button outside its form (`form` attribute).
 * Unchanged: a click that submits (also one that navigates, and one whose
 * submit handler empties a required field), a click on a `type=button`, on
 * a `formnovalidate` button, in a `novalidate` form, and a click the page
 * cancels.
 *
 * Each test loads its page again (`page navigate`, which waits for the
 * load), so no test sees another's fields or focus. The checks read the
 * page's own record of submissions (`window.submitted`) and the browser's
 * validation message, never a fixed delay.
 */

import * as assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

/** A field that blocked a submit, as `--json` reports it */
interface BlockedField {
  field: string;
  message: string;
}

/** What the tests read of `dom click --json` */
interface ClickJson {
  submitBlocked?: BlockedField[];
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
 * Click and return the JSON data.
 *
 * @param selector - Element to click
 * @returns `data` of `dom click --json`
 */
async function clickJson(selector: string): Promise<ClickJson> {
  return (JSON.parse(await bdg(['dom', 'click', selector, '--json'])) as { data: ClickJson }).data;
}

/** What the tests read of `dom a11y query --json` */
interface A11yQueryJson {
  nodes: Array<{ index: number }>;
}

/** The login form's email field in `<x-login>`'s open shadow root */
const LOGIN_EMAIL = "document.querySelector('x-login').shadowRoot.querySelector('[name=email]')";

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}shadow-forms`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom click on a submit button blocked by validation', () => {
  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}shadow-forms`]);
  });

  void it('names the invalid field and the browser message on the first click (#572)', async () => {
    await bdg(['dom', 'fill', 'input[type=email]', 'ada']);
    await bdg(['dom', 'fill', '#pin', '1234']);
    const message = await evaluate(`${LOGIN_EMAIL}.validationMessage`);
    assert.equal(typeof message, 'string');
    const output = await bdg(['dom', 'click', 'button:has-text("Go")']);
    assert.match(output, /^⚠ Element Clicked \(submit blocked\)/);
    assert.ok(
      output.includes(`Submit blocked: email: ${String(message)}`),
      `no blocked line naming email: ${output}`
    );
    assert.doesNotMatch(output, /✓ Element Clicked/);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('says so again on the next click, instead of "no visible effect"', async () => {
    await bdg(['dom', 'fill', 'input[type=email]', 'ada']);
    await bdg(['dom', 'click', 'button:has-text("Go")']);
    const output = await bdg(['dom', 'click', 'button:has-text("Go")']);
    assert.match(output, /^⚠ Element Clicked \(submit blocked\)/);
    assert.match(output, /Submit blocked: email: /);
  });

  void it('lists the blocking fields in --json as submitBlocked', async () => {
    await bdg(['dom', 'fill', 'input[type=email]', 'ada']);
    const message = await evaluate(`${LOGIN_EMAIL}.validationMessage`);
    const data = await clickJson('button:has-text("Go")');
    assert.deepEqual(data.submitBlocked, [{ field: 'email', message }]);
  });

  void it('leaves a click that submits unchanged', async () => {
    await bdg(['dom', 'fill', 'input[type=email]', 'ada@example.com']);
    const output = await bdg(['dom', 'click', 'button:has-text("Go")']);
    assert.doesNotMatch(output, /submit blocked/i);
    assert.deepEqual(await evaluate('window.submitted'), ['login:ada@example.com']);
    await bdg(['page', 'navigate', `${fixture.url}shadow-forms`]);
    await bdg(['dom', 'fill', 'input[type=email]', 'ada@example.com']);
    assert.equal((await clickJson('button:has-text("Go")')).submitBlocked, undefined);
  });
});

void describe('which clicks report a blocked submit', () => {
  /** The browser's message for an empty required field */
  let requiredMessage: unknown;

  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}submit-blocked`]);
    requiredMessage = await evaluate("document.querySelector('[name=city]').validationMessage");
  });

  void it('reports a blocked submit of a light form', async () => {
    const data = await clickJson('#light-go');
    assert.deepEqual(data.submitBlocked, [{ field: 'city', message: requiredMessage }]);
  });

  void it('reports a submit button outside its form (form attribute)', async () => {
    const data = await clickJson('#outside-go');
    assert.deepEqual(data.submitBlocked, [{ field: 'code', message: requiredMessage }]);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('reports a form in a closed shadow root, reached by dom a11y query', async () => {
    const query = JSON.parse(
      await bdg(['dom', 'a11y', 'query', 'role=button name=Pay', '--json'])
    ) as { data: A11yQueryJson };
    const pay = query.data.nodes[0];
    assert.ok(pay, 'dom a11y query finds the Pay button in the closed root');
    const output = await bdg(['dom', 'click', String(pay.index)]);
    assert.ok(
      output.includes(`Submit blocked: card: ${String(requiredMessage)}`),
      `no blocked line naming card: ${output}`
    );
  });

  void it('leaves clicks that do not submit, or skip validation, unchanged', async () => {
    assert.equal((await clickJson('#light-plain')).submitBlocked, undefined);
    assert.equal((await clickJson('#guarded-go')).submitBlocked, undefined);
    assert.equal((await clickJson('#light-skip')).submitBlocked, undefined);
    assert.equal((await clickJson('#loose-go')).submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), ['light', 'loose']);
  });

  void it('does not report a submit whose handler empties a required field', async () => {
    await bdg(['dom', 'fill', '[name=msg]', 'hi']);
    const output = await bdg(['dom', 'click', '#chat-send']);
    assert.doesNotMatch(output, /submit blocked/i);
    assert.deepEqual(await evaluate('window.submitted'), ['chat']);
  });

  void it('leaves a click that submits and navigates unchanged', async () => {
    const data = (await clickJson('#search-go')) as ClickJson & { navigation?: { url: string } };
    assert.equal(data.submitBlocked, undefined);
    assert.match(data.navigation?.url ?? '', /\/submit-blocked-done\?q=ada$/);
  });
});
