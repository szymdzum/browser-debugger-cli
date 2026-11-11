/**
 * Telling forms apart smoke test (#881).
 *
 * On a page whose forms share the page heading as their name, `dom form`
 * shows each form's selector and its method and action (secret query values
 * masked), for the selected form, the other forms and `--all`, in human and
 * `--json` output, and the selector addresses the form.
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

/** What the tests read of one form in `dom form --json` */
interface FormJson {
  name: string | null;
  selector?: string;
  action: string | null;
  method: string;
}

/** What the tests read of `dom form --json` data */
interface FormsJson {
  forms: FormJson[];
  otherForms?: Array<{
    index: number;
    name: string | null;
    selector?: string;
    action?: string | null;
    method?: string;
  }>;
}

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * The data of `dom form --json`.
 *
 * @param extra - Further flags
 * @returns The JSON data
 */
async function json(...extra: string[]): Promise<FormsJson> {
  return (JSON.parse(await bdg(['dom', 'form', '--json', ...extra])) as { data: FormsJson }).data;
}

void describe('dom form tells forms apart', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}form-identify`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('shows selector, method and action of the selected form and the others in human output', async () => {
    const output = await bdg(['dom', 'form']);
    assert.match(output, /#save\b.*POST .*\/loop/);
    assert.match(output, /Form 1: "Partner portal".*#export.*GET .*\/export\?token=/);
    assert.match(output, /Form 2: "Partner portal".*#ok.*GET .*\/done/);
    assert.match(output, /Form 3: .*GET .*\/find/);
    assert.doesNotMatch(output, /hunter2/);
  });

  void it('adds selector, action and method to the forms and otherForms in --json', async () => {
    const data = await json();
    assert.equal(data.forms[0]?.selector, '#save');
    assert.equal(data.forms[0]?.method, 'POST');
    const others = data.otherForms ?? [];
    assert.deepEqual(
      others.map((o) => [o.selector, o.method]),
      [
        ['#export', 'GET'],
        ['#ok', 'GET'],
        [others[2]?.selector, 'GET'],
      ]
    );
    assert.match(others[0]?.action ?? '', /\/export\?token=/);
    assert.doesNotMatch(JSON.stringify(data), /hunter2/);
    assert.ok(others[2]?.selector, 'the form without an id has a selector');
  });

  void it('gives every form of --all a distinct selector that addresses it', async () => {
    const data = await json('--all');
    const selectors = data.forms.map((f) => f.selector);
    assert.equal(new Set(selectors).size, 4, `selectors ${JSON.stringify(selectors)}`);
    const last = selectors[3] ?? '';
    const found = await bdg([
      'eval',
      `document.querySelectorAll(${JSON.stringify(last)}).length`,
      '--json',
    ]);
    assert.equal((JSON.parse(found) as { data: { result: unknown } }).data.result, 1);
  });
});

/**
 * Start a session on a fixture page.
 *
 * @param path - Fixture path
 * @returns The fixture server, to close afterwards
 */
async function openFixture(path: string): Promise<FixtureServer> {
  await cleanupAllSessions();
  const fixture = await startFixtureServer();
  await bdg([`${fixture.url}${path}`, '--port', String(await getFreePort()), '--headless']);
  return fixture;
}

void describe('dom form selector of forms in shadow roots', () => {
  let fixture: FixtureServer;
  before(async () => {
    fixture = await openFixture('form-identify-shadow');
  });
  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('prints a selector only when it finds exactly that form', async () => {
    const data = await json('--all');
    assert.deepEqual(
      data.forms.map((f) => f.selector),
      ['#light', undefined, undefined]
    );
  });

  void it('still shows method and action of a form without a selector in human output', async () => {
    const output = await bdg(['dom', 'form']);
    assert.match(output, /Form 1: .*\(GET .*\/inner\)/);
    assert.match(output, /Form 2: .*\(GET .*\/inner\)/);
    const all = await bdg(['dom', 'form', '--all']);
    assert.equal(all.match(/^ {3}GET .*\/inner$/gm)?.length, 2, all);
  });
});

void describe('dom form on a form with inputs named like its properties', () => {
  let fixture: FixtureServer;
  before(async () => {
    fixture = await openFixture('form-identify-clobber');
  });
  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('keeps the id selector, method and action (id, name, action, method inputs)', async () => {
    const form = (await json('--all')).forms[0];
    assert.equal(form?.selector, '#clob');
    assert.equal(form.method, 'POST');
    assert.match(form.action ?? '', /\/go$/);
  });
});
