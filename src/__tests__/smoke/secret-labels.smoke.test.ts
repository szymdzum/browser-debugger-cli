/**
 * Secret labels smoke test (#633, #642, #625, #643) on `/secret-labels`.
 *
 * A field is secret by its accessible label too: text fields whose
 * `aria-label`, `<label for>`, wrapping `<label>`, `aria-labelledby` target
 * or placeholder reads like a secret name ("Password", "Token", "API key",
 * "Security code") show `••••` on every DOM surface (`dom query`, `dom get`
 * text and `--raw`, `dom form`, `dom a11y describe|query|tree`, the
 * `dom fill` echo), human and `--json`, like a field named `password` or a
 * card field. A "Show password" checkbox and a field labelled "Passport"
 * stay readable. A field whose accessible name or description comes from a
 * secret field (`aria-labelledby`, `aria-describedby`) shows `••••` for that
 * part (#642). The "Option not found" error of a secret select lists no
 * option (#625). A secret field that blocks a submit is reported by its
 * validity state, not by Chrome's text with the value's length (#643),
 * while an ordinary field keeps Chrome's text.
 *
 * The case matrix is a table: {@link SECRET_FIELDS} (rows) × the surfaces
 * (tests); every row of a test is one cell.
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

/** Shown instead of a secret value */
const MASK = '••••';

/**
 * Values that must never be shown: the fields' values, the card number, the
 * secret select's options and option labels, the values filled into
 * labelled fields and the option looked for in the secret select.
 */
const SECRETS =
  /NAMEDSECRET1|ARIASECRET2|LABELFORSECRET3|WRAPPEDSECRET4|LABELLEDBYSECRET5|PLACEHOLDERSECRET6|CSC737|4111111111111111|OPTSECRET6|OPTLABEL6|OPTOTHER7|ARIAFILLED7|LABELFILLED8|LABELLEDBYFILLED9|WRONGPW8/;

/** Chrome's validation text of the 5-character password: its length */
const PASSWORD_LENGTH = /using 5 characters/;

/** What the secret password field reports instead */
const TOO_SHORT = 'tooShort: at least 8 characters';

/** Chrome's validation text of the ordinary 3-character nickname, kept */
const NICK_TEXT =
  'Please lengthen this text to 8 characters or more (you are currently using 3 characters).';

/** Fields that are secret, by selector and kind (the rows of the matrix) */
const SECRET_FIELDS: ReadonlyArray<readonly [selector: string, kind: string]> = [
  ['#named', 'text named password'],
  ['#aria', 'text with aria-label "Password"'],
  ['#lf', 'text with <label for> "Password"'],
  ['#wrapped', 'text wrapped in <label>Password'],
  ['#lby', 'text with aria-labelledby "Token"'],
  ['#ph', 'text with placeholder "API key"'],
  ['#csc', 'text with aria-labelledby "Security code"'],
  ['#cc', 'card number field'],
  ['#sel', 'select named password'],
];

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
 * Run a bdg command in human and `--json` mode and return both outputs.
 *
 * @param args - Full bdg argument list without `--json`
 * @param expectedExit - Expected process exit code
 * @returns Human output followed by JSON output
 */
async function bothModes(args: string[], expectedExit = 0): Promise<string> {
  return `${await bdg(args, expectedExit)}\n${await bdg([...args, '--json'], expectedExit)}`;
}

/**
 * Run a bdg command with `--json` and return its `data`.
 *
 * @param args - Full bdg argument list without `--json`
 * @returns The response's data
 */
async function bdgJson<T>(args: string[]): Promise<T> {
  return (JSON.parse(await bdg([...args, '--json'])) as { data: T }).data;
}

/**
 * Assert an output shows no secret value.
 *
 * @param output - Command output
 * @param what - Command, for the message
 */
function assertNoSecret(output: string, what: string): void {
  assert.doesNotMatch(output, SECRETS, `${what} shows a secret value`);
}

/** A field as `dom form --json` lists it */
interface FormFieldJson {
  label: string;
  selector: string;
  value: string | boolean | string[];
  validation: { valid: boolean; message?: string };
  options?: Array<{ value: string; label: string; selected: boolean }>;
}

/** What the tests read of `dom form --json` */
interface FormJson {
  forms: Array<{
    fields: FormFieldJson[];
    summary: { blockers: Array<{ label: string; reason: string }> };
  }>;
}

/** A field that blocked a submit, as `--json` reports it */
interface BlockedField {
  field: string;
  message: string;
}

/** What the tests read of `dom click --json` and `dom pressKey --json` */
interface ActionJson {
  submitBlocked?: BlockedField[];
}

void describe('secret labels', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const result = await runCommand(
      `${fixture.url}secret-labels`,
      ['--port', String(port), '--headless'],
      { timeout: 60000 }
    );
    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('dom query masks fields secret by label; the Show password checkbox and Passport stay', async () => {
    const output = await bothModes(['dom', 'query', 'input, select']);
    for (const [selector, kind] of SECRET_FIELDS) {
      assertNoSecret(output, `dom query (${kind}, ${selector})`);
    }
    assert.ok(output.includes(MASK));
    for (const plain of ['PASSPORT11', 'REFVALUE8', 'DESCVALUE9']) {
      assert.ok(output.includes(plain), `dom query hides ${plain}`);
    }
    const show = await bdgJson<{ nodes: Array<{ sensitive?: boolean; state?: unknown }> }>([
      'dom',
      'query',
      '#show',
    ]);
    assert.equal(
      show.nodes[0]?.sensitive,
      undefined,
      'the Show password checkbox is marked secret'
    );
  });

  void it('dom get masks them in text and --raw', async () => {
    for (const [selector, kind] of SECRET_FIELDS) {
      assertNoSecret(await bothModes(['dom', 'get', selector]), `dom get (${kind})`);
      assertNoSecret(await bothModes(['dom', 'get', selector, '--raw']), `dom get --raw (${kind})`);
    }
    const raw = await bdg(['dom', 'get', '#aria', '--raw']);
    assert.match(raw, /value="••••"/);
    const form = await bothModes(['dom', 'get', '#vault']);
    assertNoSecret(form, 'dom get #vault (the form\u2019s text summary)');
    assert.match(form, /Confirm( ••••)+ Go/, 'the text summary lost the select or its neighbours');
  });

  void it('dom form masks them, human and --json', async () => {
    const human = await bdg(['dom', 'form']);
    const json = await bdg(['dom', 'form', '--json']);
    for (const [selector, kind] of SECRET_FIELDS) {
      assertNoSecret(human, `dom form (${kind}, ${selector})`);
      assertNoSecret(json, `dom form --json (${kind}, ${selector})`);
    }
    assert.ok(human.includes('PASSPORT11'), 'dom form hides PASSPORT11');
    const form = (JSON.parse(json) as { data: FormJson }).data.forms[0];
    const masked = form?.fields.filter((field) => field.value === MASK).map((f) => f.selector);
    assert.deepEqual(masked, [
      '#named',
      '#aria',
      '#lf',
      '#wrapped',
      '#lby',
      '#ph',
      '#csc',
      '#cc',
      '#sel',
    ]);
    assert.equal(form?.fields.find((field) => field.selector === '#show')?.value, false);
    const select = form?.fields.find((field) => field.selector === '#sel');
    assert.deepEqual(select?.options, [
      { value: '', label: MASK, selected: true },
      { value: '', label: MASK, selected: false },
    ]);
  });

  void it('dom a11y describe masks them', async () => {
    for (const [selector, kind] of SECRET_FIELDS) {
      assertNoSecret(
        await bothModes(['dom', 'a11y', 'describe', selector]),
        `dom a11y describe (${kind})`
      );
    }
  });

  void it('dom a11y query and tree mask them', async () => {
    const query = await bothModes(['dom', 'a11y', 'query', 'role:textbox']);
    const combobox = await bothModes(['dom', 'a11y', 'query', 'role:combobox']);
    const tree = await bothModes(['dom', 'a11y', 'tree', '--limit', '0']);
    for (const [selector, kind] of SECRET_FIELDS) {
      assertNoSecret(`${query}\n${combobox}`, `dom a11y query (${kind}, ${selector})`);
      assertNoSecret(tree, `dom a11y tree (${kind}, ${selector})`);
    }
    assert.ok(query.includes('PASSPORT11'), 'a11y query hides PASSPORT11');
    assert.match(tree, /"\s*Show password\s*"/, 'a11y tree hides the Show password checkbox');
  });

  void it('masks the part of a name or description that comes from a secret field (#642)', async () => {
    const ref = await bothModes(['dom', 'a11y', 'describe', '#ref']);
    assertNoSecret(ref, 'dom a11y describe #ref');
    assert.match(ref, /Name:\s+Confirm ••••/);
    assert.ok(ref.includes('REFVALUE8'), 'the referring field’s own value is hidden');
    const desc = await bothModes(['dom', 'a11y', 'describe', '#desc']);
    assertNoSecret(desc, 'dom a11y describe #desc');
    assert.match(desc, /Description:\s+••••/);
    const descJson = await bdgJson<{ node: { description?: string } }>([
      'dom',
      'a11y',
      'describe',
      '#desc',
    ]);
    assert.equal(descJson.node.description, MASK);

    const get = await bothModes(['dom', 'get', '#ref']);
    assertNoSecret(get, 'dom get #ref');
    assert.match(get, /"Confirm ••••"/);
    assertNoSecret(await bothModes(['dom', 'get', '#desc']), 'dom get #desc');

    const query = await bothModes(['dom', 'a11y', 'query', 'name=Confirm']);
    assertNoSecret(query, 'dom a11y query name=Confirm');
    assert.match(query, /Confirm ••••/);
    const tree = await bothModes(['dom', 'a11y', 'tree', '--limit', '0']);
    assertNoSecret(tree, 'dom a11y tree');
    assert.match(tree, /Confirm ••••/);
  });

  void it('dom fill echoes a field secret by label as •••• with sensitive: true', async () => {
    const human = await bdg(['dom', 'fill', '#aria', 'ARIAFILLED7']);
    assertNoSecret(human, 'dom fill #aria');
    assert.match(human, /^Value: +••••$/m);
    for (const [selector, value] of [
      ['#lf', 'LABELFILLED8'],
      ['#lby', 'LABELLEDBYFILLED9'],
    ] as const) {
      const output = await bdg(['dom', 'fill', selector, value, '--json']);
      assertNoSecret(output, `dom fill ${selector} --json`);
      const data = (JSON.parse(output) as { data: { value?: string; sensitive?: boolean } }).data;
      assert.equal(data.value, MASK);
      assert.equal(data.sensitive, true);
    }
  });

  void it('the Option not found error of a secret select lists no option (#625)', async () => {
    const human = await bdg(['dom', 'fill', '#sel', 'WRONGPW8'], 81);
    assertNoSecret(human, 'dom fill #sel');
    assert.match(human, /Option not found/);
    assert.match(human, /2 options available/);
    const json = await bdg(['dom', 'fill', '#sel', 'WRONGPW8', '--json'], 81);
    assertNoSecret(json, 'dom fill #sel --json');
    const parsed = JSON.parse(json) as { error: string; suggestion?: string; exitCode: number };
    assert.equal(parsed.exitCode, 81);
    assert.match(parsed.suggestion ?? '', /2 options available/);
  });

  void it('the Show password checkbox is filled and echoed like any checkbox', async () => {
    const output = await bdg(['dom', 'fill', '#show', 'true', '--json']);
    const data = (JSON.parse(output) as { data: { checked?: boolean; sensitive?: boolean } }).data;
    assert.equal(data.checked, true);
    assert.equal(data.sensitive, undefined);
  });

  void it('a blocked submit reports a secret field by its validity state, not its length (#643)', async () => {
    const pw = await bdg(['dom', 'fill', '#pw', 'abcde']);
    assert.match(pw, /^Value: +••••$/m);
    await bdg(['dom', 'fill', '#nick', 'abc']);

    const click = await bdg(['dom', 'click', '#go']);
    assert.doesNotMatch(click, PASSWORD_LENGTH, 'dom click shows the password length');
    assert.match(click, /^⚠ Submit blocked: pw: tooShort: at least 8 characters; nick: /m);
    assert.ok(click.includes(NICK_TEXT), 'dom click changed the ordinary field’s text');
    const clickJson = await bdgJson<ActionJson>(['dom', 'click', '#go']);
    assert.deepEqual(clickJson.submitBlocked, [
      { field: 'pw', message: TOO_SHORT },
      { field: 'nick', message: NICK_TEXT },
    ]);

    const press = await bdg(['dom', 'pressKey', '#pw', 'Enter']);
    assert.doesNotMatch(press, PASSWORD_LENGTH, 'dom pressKey shows the password length');
    assert.match(press, /^⚠ Submit blocked: pw: tooShort: at least 8 characters; nick: /m);
    const pressJson = await bdgJson<ActionJson>(['dom', 'pressKey', '#pw', 'Enter']);
    assert.deepEqual(pressJson.submitBlocked?.[0], { field: 'pw', message: TOO_SHORT });

    const submit = await bdg(['dom', 'submit', '#vault'], 81);
    assert.doesNotMatch(submit, PASSWORD_LENGTH, 'dom submit shows the password length');
    assert.match(submit, /pw: tooShort: at least 8 characters; nick: /);

    await bdg(['dom', 'click', '#go']);
    const tree = await bothModes(['dom', 'a11y', 'tree', '--limit', '0']);
    assert.doesNotMatch(
      tree,
      PASSWORD_LENGTH,
      'the validation alert in the a11y tree shows the password length'
    );
    assert.match(tree, /\[Alert\] "••••"/);
    assert.match(tree, /^Secret values shown as •••• \(read them with bdg dom eval\)$/m);
    assert.equal(
      (await bdgJson<{ masked?: boolean }>(['dom', 'a11y', 'tree', '--limit', '0'])).masked,
      true
    );
  });

  void it('dom form reports the secret field by its validity state, not its length (#643)', async () => {
    const human = await bdg(['dom', 'form']);
    assert.doesNotMatch(human, PASSWORD_LENGTH, 'dom form shows the password length');
    const form = (await bdgJson<FormJson>(['dom', 'form'])).forms[0];
    const byLabel = (label: string): FormFieldJson | undefined =>
      form?.fields.find((field) => field.label === label);
    assert.equal(byLabel('New password')?.validation.message, TOO_SHORT);
    assert.equal(byLabel('Nickname')?.validation.message, NICK_TEXT);
    assert.deepEqual(
      form?.summary.blockers.map((blocker) => [blocker.label, blocker.reason]),
      [
        ['New password', TOO_SHORT],
        ['Nickname', NICK_TEXT],
      ]
    );
  });
});
