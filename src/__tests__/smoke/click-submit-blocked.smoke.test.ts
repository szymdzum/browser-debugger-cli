/**
 * Blocked submit smoke test (#572).
 *
 * A `dom click` on a submit button whose form fails constraint validation
 * names the fields that blocked it, the way `dom submit` does
 * (`Submit blocked: email: Please include an '@' …`, JSON `submitBlocked`),
 * from the first click on, and still exits 0. A click that submits is
 * unchanged.
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

/** The login form's email field in `<x-login>`'s open shadow root */
const LOGIN_EMAIL = "document.querySelector('x-login').shadowRoot.querySelector('[name=email]')";

void describe('dom click on a submit button blocked by validation', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}shadow-forms`, '--port', String(port), '--headless']);
  });

  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}shadow-forms`]);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
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
