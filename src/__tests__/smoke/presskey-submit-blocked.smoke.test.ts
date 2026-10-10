/**
 * Enter blocked by validation smoke test (#591).
 *
 * `dom pressKey <field> Enter` (or Space on a submit button) in a form
 * the browser submits implicitly (it has a submit button, or a single text
 * field) and whose constraint
 * validation blocks the submit is reported like such a `dom click`:
 * `⚠ Key Pressed (submit blocked)`, `Submit blocked: <field>: <message>`,
 * JSON `submitBlocked`, exit 0. On `/submit-blocked`: a light form, a
 * submit button outside its form (`form` attribute), an image input, two
 * invalid fields, Enter or Space on the submit button itself and
 * `--times 2`. On `/implicit-submit`: a single field without a button, two
 * fields with an image input as the default button, forms whose own Enter
 * handler calls `requestSubmit()` (with and without `preventDefault()`,
 * each field named once), Enter while the page loads an image, the sign-up
 * form of the issue (three invalid fields) and a form in a closed shadow
 * root. Validity checks the page runs before the key press (on input and
 * blur) are not reported.
 * Unchanged: a valid form, a `novalidate` form, a default button whose
 * click the page cancels, a submit whose handler empties its field, a
 * `<textarea>`, a form with two text fields and no button, a disabled
 * submit button, other keys (Space in a text field too), a `type=button`
 * and the body.
 *
 * Each test loads its page again (`page navigate`, which waits for the
 * load). The checks read the page's own record of submissions
 * (`window.submitted`) and the browser's validation messages, never a
 * fixed delay.
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

/** What the tests read of `dom pressKey --json` */
interface PressKeyJson {
  submitBlocked?: BlockedField[];
  submitBlockedOmitted?: number;
  times?: number;
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
 * The browser's validation message of the field a selector finds.
 *
 * @param selector - Field selector (light DOM)
 * @returns Its `validationMessage`
 */
async function validationMessage(selector: string): Promise<unknown> {
  return evaluate(`document.querySelector(${JSON.stringify(selector)}).validationMessage`);
}

/**
 * Press a key and return the JSON data.
 *
 * @param args - Target, key and options of `dom pressKey`
 * @returns `data` of `dom pressKey --json`
 */
async function pressKeyJson(...args: string[]): Promise<PressKeyJson> {
  const output = await bdg(['dom', 'pressKey', ...args, '--json']);
  return (JSON.parse(output) as { data: PressKeyJson }).data;
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}submit-blocked`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom pressKey Enter in a form with a submit button', () => {
  /** The browser's message for an empty required field */
  let requiredMessage: unknown;

  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}submit-blocked`]);
    requiredMessage = await validationMessage('[name=city]');
    assert.equal(typeof requiredMessage, 'string');
  });

  void it('says the submit was blocked and names the field (#591)', async () => {
    const output = await bdg(['dom', 'pressKey', 'input[name=city]', 'Enter']);
    assert.match(output, /^⚠ Key Pressed \(submit blocked\)/);
    assert.ok(
      output.includes(`Submit blocked: city: ${String(requiredMessage)}`),
      `no blocked line naming city: ${output}`
    );
    assert.doesNotMatch(output, /✓ Key Pressed/);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('lists the blocking fields in --json as submitBlocked', async () => {
    const data = await pressKeyJson('input[name=city]', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'city', message: requiredMessage }]);
  });

  void it('reports a form whose submit button is outside it (form attribute)', async () => {
    const data = await pressKeyJson('[name=code]', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'code', message: requiredMessage }]);
  });

  void it('reports a form submitted by an image input', async () => {
    const data = await pressKeyJson('[name=term]', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'term', message: requiredMessage }]);
  });

  void it('names two invalid fields, separated by "; "', async () => {
    const mailMessage = await validationMessage('[name=mail]');
    const output = await bdg(['dom', 'pressKey', '[name=first]', 'Enter']);
    assert.ok(
      output.includes(
        `Submit blocked: first: ${String(requiredMessage)}; mail: ${String(mailMessage)}`
      ),
      `no blocked line naming both fields: ${output}`
    );
  });

  void it('reports Enter on the submit button itself, which clicks it', async () => {
    const data = await pressKeyJson('#light-go', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'city', message: requiredMessage }]);
  });

  void it('reports Space on a submit button, which clicks it on keyup', async () => {
    const output = await bdg(['dom', 'pressKey', '#light-go', 'Space']);
    assert.match(output, /^⚠ Key Pressed \(submit blocked\)/);
    assert.ok(
      output.includes(`Submit blocked: city: ${String(requiredMessage)}`),
      `no blocked line naming city: ${output}`
    );
    const data = await pressKeyJson('#pictured-go', 'Space');
    assert.deepEqual(data.submitBlocked, [{ field: 'term', message: requiredMessage }]);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('leaves Space in a text field and on a type=button unchanged', async () => {
    assert.equal((await pressKeyJson('[name=city]', 'Space')).submitBlocked, undefined);
    assert.equal(await evaluate("document.querySelector('[name=city]').value"), ' ');
    assert.equal((await pressKeyJson('#light-plain', 'Space')).submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('reports a blocked submit once for --times 2', async () => {
    const output = await bdg(['dom', 'pressKey', '[name=city]', 'Enter', '--times', '2']);
    assert.match(output, /^⚠ Key Pressed \(submit blocked\)/);
    assert.equal(output.split('Submit blocked: ').length - 1, 1, output);
    const data = await pressKeyJson('[name=city]', 'Enter', '--times', '2');
    assert.equal(data.times, 2);
    assert.deepEqual(data.submitBlocked, [{ field: 'city', message: requiredMessage }]);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('leaves Enter in a valid form unchanged', async () => {
    await bdg(['dom', 'fill', '[name=city]', 'Paris']);
    const output = await bdg(['dom', 'pressKey', '[name=city]', 'Enter']);
    assert.doesNotMatch(output, /submit blocked/i);
    assert.deepEqual(await evaluate('window.submitted'), ['light']);
  });

  void it('leaves Enter in a novalidate form, a canceled default button and a handler that empties its field unchanged', async () => {
    assert.equal((await pressKeyJson('[name=zip]', 'Enter')).submitBlocked, undefined);
    assert.equal((await pressKeyJson('[name=nick]', 'Enter')).submitBlocked, undefined);
    await bdg(['dom', 'fill', '[name=msg]', 'hi']);
    assert.equal((await pressKeyJson('[name=msg]', 'Enter')).submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), ['loose', 'chat']);
  });

  void it('leaves other keys, a type=button and the body unchanged', async () => {
    assert.equal((await pressKeyJson('[name=city]', 'a')).submitBlocked, undefined);
    assert.equal((await pressKeyJson('[name=city]', 'Tab')).submitBlocked, undefined);
    assert.equal((await pressKeyJson('#light-plain', 'Enter')).submitBlocked, undefined);
    assert.equal((await pressKeyJson('body', 'Enter')).submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });
});

void describe('dom pressKey Enter in forms without a usable submit button', () => {
  /** The browser's message for an empty required field */
  let requiredMessage: unknown;

  beforeEach(async () => {
    await bdg(['page', 'navigate', `${fixture.url}implicit-submit`]);
    requiredMessage = await validationMessage('[name=nick]');
    assert.equal(typeof requiredMessage, 'string');
  });

  void it('reports a form with a single field and no button', async () => {
    const output = await bdg(['dom', 'pressKey', '[name=nick]', 'Enter']);
    assert.match(output, /^⚠ Key Pressed \(submit blocked\)/);
    assert.ok(
      output.includes(`Submit blocked: nick: ${String(requiredMessage)}`),
      `no blocked line naming nick: ${output}`
    );
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('reports a form whose default button is an image input, with two text fields', async () => {
    const data = await pressKeyJson('[name=t1]', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 't1', message: requiredMessage }]);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('reports a submit the page blocks in its own Enter handler (preventDefault, requestSubmit)', async () => {
    const output = await bdg(['dom', 'pressKey', '[name=handle]', 'Enter']);
    assert.match(output, /^⚠ Key Pressed \(submit blocked\)/);
    assert.ok(
      output.includes(`Submit blocked: handle: ${String(requiredMessage)}`),
      `no blocked line naming handle: ${output}`
    );
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('names a field once when the page and Enter both try to submit', async () => {
    const output = await bdg(['dom', 'pressKey', '[name=alias]', 'Enter']);
    assert.equal(output.split('alias: ').length - 1, 1, output);
    const data = await pressKeyJson('[name=alias]', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'alias', message: requiredMessage }]);
  });

  void it('reports a blocked submit while the page loads an asset', async () => {
    const data = await pressKeyJson('[name=code5]', 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'code5', message: requiredMessage }]);
  });

  void it('leaves out validity checks the page ran before the key press', async () => {
    await bdg(['dom', 'fill', '[name=zip5]', 'abc']);
    await evaluate("document.querySelector('[name=zip5]').focus(), true");
    const data = await pressKeyJson('[name=other]', 'Enter');
    assert.equal(data.submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('names the three invalid fields of the sign-up form (the issue page)', async () => {
    const expected = [];
    for (const name of ['email', 'password', 'terms']) {
      expected.push({ field: name, message: await validationMessage(`[name=${name}]`) });
    }
    const data = await pressKeyJson('[name=email]', 'Enter');
    assert.deepEqual(data.submitBlocked, expected);
  });

  void it('reports a form in a closed shadow root, reached by dom a11y query', async () => {
    const query = JSON.parse(
      await bdg(['dom', 'a11y', 'query', 'role=textbox name=Card', '--json'])
    ) as { data: { nodes: Array<{ index: number }> } };
    const card = query.data.nodes[0];
    assert.ok(card, 'dom a11y query finds the Card field in the closed root');
    const data = await pressKeyJson(String(card.index), 'Enter');
    assert.deepEqual(data.submitBlocked, [{ field: 'card', message: requiredMessage }]);
  });

  void it('leaves Enter in a textarea unchanged', async () => {
    const output = await bdg(['dom', 'pressKey', '[name=body]', 'Enter']);
    assert.match(output, /^✓ Key Pressed/);
    assert.equal(await evaluate("document.querySelector('[name=body]').value"), '\n');
    assert.deepEqual(await evaluate('window.submitted'), []);
  });

  void it('leaves forms that Enter does not submit unchanged (two fields, disabled button)', async () => {
    assert.equal((await pressKeyJson('[name=first]', 'Enter')).submitBlocked, undefined);
    assert.equal((await pressKeyJson('[name=pin]', 'Enter')).submitBlocked, undefined);
    assert.deepEqual(await evaluate('window.submitted'), []);
  });
});
