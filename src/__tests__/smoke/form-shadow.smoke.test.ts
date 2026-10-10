/**
 * Forms in shadow roots smoke test.
 *
 * `dom form` lists forms and form-less fields that web components render in
 * open shadow roots (nested ones included), with labels resolved inside the
 * root, secret values masked and indices that `dom fill` / `dom submit`
 * accept; a component whose closed shadow root holds fields is named as not
 * inspectable, with the way to reach them (`dom a11y query`, then
 * `dom fill <index>`), which works; `dom get` on that component says its
 * root is closed instead of pointing to `dom inspect`. The search form a
 * component renders when it opens is listed once it is open (like MDN's
 * search modal).
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

/** What the tests read of `dom form --json` */
interface FormJson {
  name: string | null;
  shadowHost?: string;
  inDialog: boolean;
  fields: Array<{
    index: number;
    name: string | null;
    label: string;
    required: boolean;
    value: unknown;
  }>;
  buttons: Array<{ index: number; label: string }>;
}

/** `dom form --all --json` data */
interface FormsJson {
  forms: FormJson[];
  closedShadowHosts?: string[];
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
 * All forms `dom form` finds.
 *
 * @returns The JSON data
 */
async function discover(): Promise<FormsJson> {
  return (JSON.parse(await bdg(['dom', 'form', '--all', '--json'])) as { data: FormsJson }).data;
}

/**
 * The form holding a field with a name.
 *
 * @param data - Discovery data
 * @param fieldName - Name of one of its fields
 * @returns The form
 */
function formWith(data: FormsJson, fieldName: string): FormJson {
  const form = data.forms.find((f) => f.fields.some((field) => field.name === fieldName));
  assert.ok(form, `no form with field ${fieldName}: ${JSON.stringify(data.forms)}`);
  return form;
}

/**
 * A field by name.
 *
 * @param form - Form
 * @param name - Field name
 * @returns The field
 */
function field(form: FormJson, name: string): FormJson['fields'][number] {
  const found = form.fields.find((f) => f.name === name);
  assert.ok(found, `no field ${name} in ${JSON.stringify(form.fields)}`);
  return found;
}

void describe('Forms in shadow roots', () => {
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

  void it('lists the form in an open shadow root with its labels and required fields', async () => {
    const data = await discover();
    const login = formWith(data, 'email');
    assert.equal(login.shadowHost, 'x-login');
    assert.deepEqual(
      { label: field(login, 'email').label, required: field(login, 'email').required },
      { label: 'Email', required: true }
    );
    assert.equal(field(login, 'password').label, 'Your passphrase');
    assert.equal(field(login, 'pin').label, 'Card code');
    assert.deepEqual(
      login.buttons.map((b) => b.label),
      ['Go']
    );

    const brief = await bdg(['dom', 'form', '--all', '--brief']);
    assert.match(brief, /\(in shadow root of <x-login>\)/);
    assert.match(brief, /Email\s+\*/);
  });

  void it('masks secret fields inside a shadow root', async () => {
    const output = await bdg(['dom', 'form', '--all', '--json']);
    assert.doesNotMatch(output, /Hunter2Secret|4321/);
    const login = formWith((JSON.parse(output) as { data: FormsJson }).data, 'email');
    assert.equal(field(login, 'password').value, '••••');
    assert.equal(field(login, 'pin').value, '••••');
  });

  void it('lists a form two shadow roots deep, labelled inside its root', async () => {
    const newsletter = formWith(await discover(), 'nl-email');
    assert.equal(newsletter.shadowHost, 'x-inner');
    assert.equal(newsletter.name, 'Newsletter');
    assert.equal(field(newsletter, 'nl-email').label, 'Newsletter email');
    assert.equal(field(newsletter, 'nl-name').required, true);
  });

  void it('keeps a component field in the light form that holds the component', async () => {
    const data = await discover();
    const profile = formWith(data, 'city');
    assert.equal(profile.shadowHost, undefined);
    assert.equal(field(profile, 'city').label, 'City');
    assert.deepEqual(
      profile.buttons.map((b) => b.label),
      ['Save']
    );
  });

  void it('fills and submits by the indices dom form prints', async () => {
    const data = await discover();
    const login = formWith(data, 'email');
    await bdg(['dom', 'fill', String(field(login, 'email').index), 'ada@example.com']);
    assert.equal(
      await evaluate(
        "document.querySelector('x-login').shadowRoot.querySelector('[name=email]').value"
      ),
      'ada@example.com'
    );
    const newsletter = formWith(data, 'nl-email');
    await bdg(['dom', 'fill', String(field(newsletter, 'nl-name').index), 'Ada']);
    assert.equal(
      await evaluate(
        "document.querySelector('x-outer').shadowRoot.querySelector('x-inner').shadowRoot.querySelector('#nl-name').value"
      ),
      'Ada'
    );
    const go = login.buttons.find((b) => b.label === 'Go');
    assert.ok(go);
    await bdg(['dom', 'submit', String(go.index)]);
    assert.deepEqual(await evaluate('window.submitted'), ['login:ada@example.com']);
  });

  void it('names a component whose closed shadow root holds fields as not inspectable', async () => {
    const data = await discover();
    assert.deepEqual(data.closedShadowHosts, ['x-vault']);
    assert.ok(
      data.forms.every((form) => form.fields.every((f) => f.name !== 'card-holder')),
      'closed root fields are not listed'
    );
    const output = await bdg(['dom', 'form', '--all']);
    assert.match(output, /<x-vault> has a closed shadow root/);
    assert.match(output, /reach them with bdg dom a11y query role=textbox, then bdg dom fill/);
  });

  void it('points selectors that miss to the closed shadow host and dom a11y query', async () => {
    const closedNote =
      /The page has closed shadow roots \(in <x-vault>\), which are not searched\.\nFor an element in a closed shadow root: bdg dom a11y query role=textbox/;
    for (const args of [
      ['dom', 'query', 'x-vault input'],
      ['dom', 'query', 'input[name=card-holder]'],
      ['dom', 'fill', 'input[name=card-holder]', 'x'],
      ['dom', 'click', 'x-vault button'],
      ['dom', 'inspect', 'input[name=card-holder]'],
    ]) {
      const output = await bdg(args, 83);
      assert.match(output, closedNote, `bdg ${args.join(' ')}`);
      assert.doesNotMatch(output, /eval --frame/, `bdg ${args.join(' ')}: no iframe on the page`);
    }
  });

  void it('dom inspect on a closed shadow host says where its children are', async () => {
    assert.match(
      await bdg(['dom', 'inspect', 'x-vault']),
      /^shadow closed root, not shown: bdg dom a11y query, e\.g\. role=textbox, lists its elements by index/m
    );
    const json = JSON.parse(await bdg(['dom', 'inspect', 'x-vault', '--json'])) as {
      data: { shadowRootMode?: string };
    };
    assert.equal(json.data.shadowRootMode, 'closed');
    const open = await bdg(['dom', 'inspect', 'x-login']);
    assert.match(open, /\(shadow root\)/);
    assert.doesNotMatch(open, /closed root/);
  });

  void it('reaches a closed shadow root field the way the notes say: a11y query, then fill by index', async () => {
    const query = JSON.parse(await bdg(['dom', 'a11y', 'query', 'role=textbox', '--json'])) as {
      data: { nodes: Array<{ index: number; backendDOMNodeId: number }> };
    };
    let cardHolder: { index: number } | undefined;
    for (const node of query.data.nodes) {
      const html = await bdg(['dom', 'get', '--node-id', String(node.backendDOMNodeId)]);
      if (html.includes('name="card-holder"')) cardHolder = node;
    }
    assert.ok(cardHolder, 'dom a11y query lists the field in the closed root');
    await bdg(['dom', 'get', String(cardHolder.index)]);
    await bdg(['dom', 'fill', String(cardHolder.index), 'Ada Lovelace']);
    const after = JSON.parse(await bdg(['dom', 'a11y', 'query', 'role=textbox', '--json'])) as {
      data: { nodes: Array<{ index: number; value?: string }> };
    };
    assert.equal(after.data.nodes[cardHolder.index]?.value, 'Ada Lovelace');
  });

  void it('dom get on a closed shadow host names the root closed, not dom inspect (#574)', async () => {
    const output = await bdg(['dom', 'get', 'x-vault']);
    assert.match(output, /^No text; its closed shadow root holds 1 element: form \(/m);
    assert.match(output, /bdg dom a11y query/);
    assert.doesNotMatch(output, /dom inspect\)/, 'dom inspect shows nothing of a closed root');
    const json = JSON.parse(await bdg(['dom', 'get', 'x-vault', '--json'])) as {
      data: { domContext: { shadowChildren?: boolean; shadowRootMode?: string } };
    };
    assert.equal(json.data.domContext.shadowChildren, true);
    assert.equal(json.data.domContext.shadowRootMode, 'closed');
  });

  void it('lists the search form a component renders once it is opened', async () => {
    assert.ok((await discover()).forms.every((form) => form.fields.every((f) => f.name !== 'q')));
    await bdg(['dom', 'click', '#open-search']);
    const data = await discover();
    const search = formWith(data, 'q');
    assert.equal(search.shadowHost, 'x-search-modal');
    assert.equal(search.inDialog, true);
    assert.equal(data.forms[0], search, 'the open dialog form comes first');
    await bdg(['dom', 'fill', String(field(search, 'q').index), 'flexbox']);
    assert.equal(
      await evaluate(
        "document.querySelector('x-search-modal').shadowRoot.querySelector('[name=q]').value"
      ),
      'flexbox',
      'indices follow the order forms are listed in'
    );
    assert.match(
      await bdg(['dom', 'form', '--brief']),
      /Form: "Search" \(in dialog\) \(in shadow root of <x-search-modal>\)/
    );
  });

  void it('lists form-less fields in an open shadow root', async () => {
    await bdg(['page', 'navigate', `${fixture.url}shadow-fields`]);
    const data = await discover();
    assert.equal(data.forms.length, 1);
    const group = formWith(data, 'filter');
    assert.equal(group.shadowHost, 'x-filter');
    assert.deepEqual(
      { label: field(group, 'filter').label, required: field(group, 'filter').required },
      { label: 'Filter', required: true }
    );
    await bdg(['dom', 'fill', String(field(group, 'filter').index), 'red']);
    assert.equal(
      await evaluate("document.querySelector('x-filter').shadowRoot.querySelector('input').value"),
      'red'
    );
  });
});
