/**
 * `dom fill` as a user edit, and its masked echo, smoke test (#592).
 *
 * Chrome applies `minlength` (`validity.tooShort`) only to a value a user
 * entered. `dom fill` enters text in a text-like field as a user would, so
 * after filling a value shorter than `minlength` the field is invalid: the
 * fill warns, `dom form` lists the field as invalid, and a `dom click` on
 * the submit button or `dom pressKey Enter` reports `submitBlocked` (on
 * `/fill-user-edit`: a password, a nickname, a textarea, and a field in an
 * open shadow root). The events are those of typing (`beforeinput` and
 * `input`, `insertText`, trusted). A value long enough submits, and a
 * value over `maxlength` is still refused (exit 81).
 *
 * The echo of a secret field (`Value:`, JSON `value`) is masked with the
 * rule `dom query` uses: passwords, a one-time code, a CSS-masked field and
 * fields named like a card code or PIN show `••••`, also on
 * `/shadow-forms` (`#pin`, `#pw`), and a value mismatch of a secret field
 * is reported by length only; an ordinary field shows its value.
 *
 * Each test loads its page again (`page navigate`, which waits for the
 * load). The checks read the page's record of submissions and events and
 * the browser's validity state, never a fixed delay.
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

/** What the tests read of `dom fill --json` */
interface FillJson {
  value?: string;
  sensitive?: boolean;
  warning?: string;
  valueMismatch?: { expected: string; actual: string };
}

/** What the tests read of `dom form --json` */
interface FormJson {
  forms: Array<{ fields: Array<{ name: string | null; validation: { valid: boolean } }> }>;
}

/** The masked value `dom query` shows for a secret field */
const MASKED = '••••';

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
 * Run a bdg command with `--json` and return its `data`.
 *
 * @param args - Full bdg argument list, without `--json`
 * @returns `data` of the response
 */
async function json<T>(args: string[]): Promise<T> {
  return (JSON.parse(await bdg([...args, '--json'])) as { data: T }).data;
}

/**
 * Evaluate an expression in the page and return its result.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  return (await json<{ result: unknown }>(['dom', 'eval', expression])).result;
}

/**
 * A field's validity in the page.
 *
 * @param field - Expression for the field
 * @returns `tooShort` and the browser's validation message
 */
async function validity(field: string): Promise<{ tooShort: boolean; message: string }> {
  return (await evaluate(
    `({ tooShort: ${field}.validity.tooShort, message: ${field}.validationMessage })`
  )) as { tooShort: boolean; message: string };
}

/** The alias field in `<x-alias>`'s open shadow root */
const ALIAS = "document.querySelector('x-alias').shadowRoot.querySelector('#alias')";

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}fill-user-edit`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom fill enters text as a user edit (#592)', () => {
  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}fill-user-edit`]);
  });

  void it('makes a too-short password invalid, so the submit click is blocked', async () => {
    await bdg(['dom', 'fill', '#mlp', 'short']);
    const state = await validity("document.querySelector('#mlp')");
    assert.equal(state.tooShort, true, 'minlength applies after dom fill');
    const form = await json<FormJson>(['dom', 'form']);
    const password = form.forms[0]?.fields.find((field) => field.name === 'password');
    assert.equal(password?.validation.valid, false, 'dom form lists the password as invalid');
    const click = await json<{ submitBlocked?: BlockedField[] }>(['dom', 'click', '#go']);
    assert.deepEqual(click.submitBlocked, [{ field: 'password', message: state.message }]);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('reports the blocked submit for Enter in a too-short field', async () => {
    await bdg(['dom', 'fill', '#mlp', 'long enough']);
    await bdg(['dom', 'fill', '#nick', 'ab']);
    const state = await validity("document.querySelector('#nick')");
    assert.equal(state.tooShort, true);
    const press = await json<{ submitBlocked?: BlockedField[] }>([
      'dom',
      'pressKey',
      '#nick',
      'Enter',
    ]);
    assert.deepEqual(press.submitBlocked, [{ field: 'nick', message: state.message }]);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('warns when the value is shorter than minlength', async () => {
    const output = await bdg(['dom', 'fill', '#nick', 'ab']);
    assert.match(output, /^⚠ Element Filled/);
    assert.match(output, /shorter than the field's minlength \(4\)/);
    const data = await json<FillJson>(['dom', 'fill', '#nick', 'ab']);
    assert.match(data.warning ?? '', /shorter than the field's minlength \(4\)/);
  });

  void it('applies minlength to a textarea and to a field in an open shadow root', async () => {
    await bdg(['dom', 'fill', '#bio', 'too short']);
    assert.equal((await validity("document.querySelector('#bio')")).tooShort, true);
    await bdg(['dom', 'fill', '#alias', 'ab']);
    const alias = await validity(ALIAS);
    assert.equal(alias.tooShort, true);
    const click = await json<{ submitBlocked?: BlockedField[] }>(['dom', 'click', '#alias-go']);
    assert.deepEqual(click.submitBlocked, [{ field: 'alias', message: alias.message }]);
  });

  void it('fires the trusted beforeinput and input events of typing', async () => {
    await evaluate("document.querySelector('#nick').value = 'old'");
    await bdg(['dom', 'fill', '#nick', 'Ada Lovelace']);
    assert.deepEqual(await evaluate('window.inputLog.splice(0)'), [
      'nick beforeinput insertText Ada Lovelace trusted',
      'nick input insertText Ada Lovelace trusted',
    ]);
    assert.equal(await evaluate("document.querySelector('#nick').value"), 'Ada Lovelace');
  });

  void it('submits a value long enough', async () => {
    await bdg(['dom', 'fill', '#mlp', 'correct horse']);
    assert.equal((await validity("document.querySelector('#mlp')")).tooShort, false);
    const click = await json<{ submitBlocked?: BlockedField[] }>(['dom', 'click', '#go']);
    assert.equal(click.submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), ['signup']);
  });

  void it('still refuses a value over maxlength (exit 81) and leaves the field alone', async () => {
    const output = await bdg(['dom', 'fill', '#code', 'abcdefg'], 81);
    assert.match(output, /Value is 7 characters; the field accepts at most 4/);
    assert.equal(await evaluate("document.querySelector('#code').value"), '');
  });
});

void describe('dom fill echoes secret fields masked, as dom query does (#592)', () => {
  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}fill-user-edit`]);
  });

  void it('masks a password, a one-time code, a CSS-masked field and a card code', async () => {
    for (const [selector, value] of [
      ['#mlp', 'hunter2'],
      ['#otp', '123456'],
      ['#dots', 'my hint'],
      ['#cvv', '987'],
    ] as const) {
      const output = await bdg(['dom', 'fill', selector, value]);
      assert.match(output, /^Value: +••••$/m, `${selector}: ${output}`);
      assert.ok(!output.includes(value), `${selector} echoes its value: ${output}`);
      const data = await json<FillJson>(['dom', 'fill', selector, value]);
      assert.equal(data.value, MASKED, selector);
      assert.equal(data.sensitive, true, selector);
    }
  });

  void it('shows an ordinary field and an emptied secret field as they are', async () => {
    assert.match(await bdg(['dom', 'fill', '#city', 'Paris']), /^Value: +Paris$/m);
    assert.equal((await json<FillJson>(['dom', 'fill', '#city', 'Paris'])).sensitive, undefined);
    await bdg(['dom', 'fill', '#mlp', 'short']);
    assert.match(await bdg(['dom', 'fill', '#mlp', '']), /^Value: +\(empty\)$/m);
  });

  void it('reports a secret field the page changed without its value or length', async () => {
    const data = await json<FillJson>(['dom', 'fill', '#digits', 'ab12cd34ef56']);
    assert.deepEqual(data.valueMismatch, { expected: MASKED, actual: MASKED, masked: true });
    assert.match(data.warning ?? '', /secret field, value not shown/);
    assert.doesNotMatch(
      data.warning ?? '',
      /\d/,
      `warning gives a length or the value: ${data.warning}`
    );
    await bdg(['page', 'navigate', `${fixture.url}fill-user-edit`]);
    const output = await bdg(['dom', 'fill', '#digits', 'ab12cd34ef56']);
    assert.match(
      output,
      /The page kept another value than the one filled \(secret field, value not shown\)/
    );
    assert.doesNotMatch(
      output,
      /length|\b(6|12)\b|123456/,
      `the output gives a length or the value: ${output}`
    );
  });

  void it('refuses a secret value over maxlength, or one the browser rejects, without its length or text', async () => {
    const tooLong = await bdg(['dom', 'fill', '#cvv', '98765'], 81);
    assert.match(tooLong, /The value is longer than the field accepts \(at most 4 characters\)/);
    assert.doesNotMatch(tooLong, /\b5\b|98765/, tooLong);
    const rejected = await bdg(['dom', 'fill', '#npin', 'x9z'], 81);
    assert.match(rejected, /The browser rejected the value for a number field/);
    assert.ok(!rejected.includes('x9z'), rejected);
  });

  void it('masks the PIN and the password of /shadow-forms', async () => {
    await bdg(['page', 'navigate', `${fixture.url}shadow-forms`]);
    const pin = await bdg(['dom', 'fill', '#pin', '9876']);
    assert.match(pin, /^Value: +••••$/m);
    assert.ok(!pin.includes('9876'), pin);
    assert.match(await bdg(['dom', 'fill', '#pw', 'secret99']), /^Value: +••••$/m);
  });
});

void describe('dom fill when the page moves the focus as it types (#592)', () => {
  /** Value of a field on the page, by id */
  const valueOf = async (id: string): Promise<unknown> =>
    evaluate(`document.getElementById('${id}').value`);

  /**
   * Fill and return the exit code and output.
   *
   * @param selector - Field to fill
   * @param value - Value
   * @returns Exit code and combined output
   */
  const fill = async (
    selector: string,
    value: string
  ): Promise<{ exit: number; output: string }> => {
    const result = await runCommand('dom', ['fill', selector, value], { timeout: 60000 });
    return { exit: result.exitCode, output: `${result.stdout}${result.stderr}` };
  };

  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}fill-focus-steal`]);
  });

  void it('fails (exit 90) naming the field that got the text, never echoing it', async () => {
    for (const id of ['bi', 'bip']) {
      const { exit, output } = await fill(`#${id}`, 'SECRET99');
      assert.equal(exit, 90, output);
      assert.match(output, new RegExp(`Did not fill input#${id} .*moved the focus to input#vis`));
      assert.ok(!output.includes('SECRET99'), `the text is echoed: ${output}`);
      assert.equal(await valueOf(id), '', 'no value is set in the field asked for');
      assert.equal(await valueOf('vis'), 'SECRET99', 'the page put the text in #vis');
      await evaluate("document.getElementById('vis').value = ''");
    }
  });

  void it('never reports success while the text sits in another field (focus moved 30 ms later)', async () => {
    for (const id of ['ta', 'tp']) {
      const { exit, output } = await fill(`#${id}`, 'SECRET99');
      if (id === 'tp') assert.ok(!output.includes('SECRET99'), `the password is echoed: ${output}`);
      if (exit === 0) {
        assert.equal(await valueOf(id), 'SECRET99');
        assert.equal(await valueOf('vis'), '', `success, but #vis got the text: ${output}`);
      } else {
        assert.equal(exit, 90, output);
        assert.match(output, /moved the focus to input#vis/);
      }
      await bdg(['page', 'navigate', `${fixture.url}fill-focus-steal`]);
    }
  });

  void it('sets the value without typing, with a warning, when the field lost the focus before', async () => {
    const { exit, output } = await fill('#mt', 'Ada');
    assert.equal(exit, 0, output);
    assert.match(
      output,
      /The value was set by script, not typed \(the field lost the focus before bdg typed\), so the browser does not apply minlength to it/
    );
    assert.equal(await valueOf('mt'), 'Ada');
    assert.equal(await valueOf('vis'), '');
  });

  void it('does not blame another field when the page cancelled the text and moved the focus', async () => {
    const { exit, output } = await fill('#cm', 'Ada');
    assert.equal(exit, 0, output);
    assert.match(output, /The page cancelled beforeinput/);
    assert.equal(await valueOf('cm'), 'Ada');
    assert.equal(await valueOf('vis'), '');
  });

  void it('warns when a field that cannot take the focus gets its value by script', async () => {
    const { exit, output } = await fill('#gone', 'Ada');
    assert.equal(exit, 0, output);
    assert.match(output, /not typed \(the field did not take the focus\)/);
    assert.equal(await valueOf('gone'), 'Ada');
    const data = await json<FillJson>(['dom', 'fill', '#gone', 'Bea']);
    assert.match(data.warning ?? '', /not typed \(the field did not take the focus\)/);
  });

  void it('fills one-digit code fields whose input moves the focus to the next', async () => {
    for (const [index, digit] of ['4', '2', '7', '1'].entries()) {
      const { exit, output } = await fill(`#otp-${index + 1}`, digit);
      assert.equal(exit, 0, output);
      assert.match(output, /^✓ Element Filled/);
    }
    assert.deepEqual(
      await evaluate(
        "['otp-1', 'otp-2', 'otp-3', 'otp-4', 'vis'].map((id) => document.getElementById(id).value)"
      ),
      ['4', '2', '7', '1', '']
    );
  });
});
