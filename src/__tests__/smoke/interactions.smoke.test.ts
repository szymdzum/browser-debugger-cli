/**
 * Interactions smoke test.
 *
 * Drives the `/interactions` fixture with `dom fill`, `dom pressKey` and
 * `dom click` and asserts on what the page observed: trusted key input,
 * Enter semantics, controlled checkboxes, pointer-driven menus, and clear
 * errors for read-only and disabled fields.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';

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
 * Evaluate an expression in the page and return its JSON-decoded result.
 *
 * @param expression - JavaScript expression
 * @returns Evaluation result
 */
async function evaluate(expression: string): Promise<unknown> {
  const output = await bdg(['dom', 'eval', expression, '--json']);
  return (JSON.parse(output) as { data: { result: unknown } }).data.result;
}

/**
 * Read and reset the page's event log.
 *
 * @returns Logged events as `"<id>:<type>[:<key>]"`
 */
async function takeEvents(): Promise<string[]> {
  return (await evaluate('window.events.splice(0)')) as string[];
}

void describe('DOM interactions', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}interactions`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('pressKey types characters with trusted key events', async () => {
    await evaluate("document.getElementById('name').focus()");
    await bdg(['dom', 'pressKey', '#name', 'a']);
    await bdg(['dom', 'pressKey', '#name', 'b', '--modifiers', 'shift']);
    await bdg(['dom', 'pressKey', '#name', '1', '--modifiers', 'shift']);
    assert.equal(await evaluate("document.getElementById('name').value"), 'aB!');
    const events = await takeEvents();
    assert.ok(events.includes('name:keypress:a'), events.join(','));
    assert.ok(events.includes('name:input'), events.join(','));
  });

  void it('Enter adds a newline in a textarea and submits from an input', async () => {
    await bdg(['dom', 'pressKey', '#notes', 'Enter']);
    assert.equal(await evaluate("document.getElementById('notes').value"), '\n');
    assert.equal(await evaluate('window.submits'), 0);

    await bdg(['dom', 'pressKey', '#name', 'Enter']);
    assert.equal(await evaluate('window.submits'), 1);
  });

  void it('runs editing shortcuts like Ctrl+A and Cmd+Z', async () => {
    await evaluate("document.getElementById('notes').value = 'hello world'");
    for (const modifier of ['ctrl', 'meta']) {
      await evaluate("document.getElementById('notes').setSelectionRange(0, 0)");
      await bdg(['dom', 'pressKey', '#notes', 'a', '--modifiers', modifier]);
      assert.deepEqual(
        await evaluate(
          "[document.getElementById('notes').selectionStart, document.getElementById('notes').selectionEnd]"
        ),
        [0, 11],
        `${modifier}+a selects all`
      );
    }
    await bdg(['dom', 'pressKey', '#notes', 'x', '--modifiers', 'ctrl']);
    assert.equal(await evaluate("document.getElementById('notes').value"), '');
    await bdg(['dom', 'pressKey', '#notes', 'z', '--modifiers', 'meta']);
    assert.equal(await evaluate("document.getElementById('notes').value"), 'hello world');
    await bdg(['dom', 'pressKey', '#notes', 'z', '--modifiers', 'ctrl,shift']);
    assert.equal(await evaluate("document.getElementById('notes').value"), '', 'redo');
    await bdg(['dom', 'pressKey', '#notes', 'v', '--modifiers', 'ctrl']);
    assert.equal(await evaluate("document.getElementById('notes').value"), 'hello world', 'paste');
    await takeEvents();
  });

  void it('writes screenshots in the format their file name says', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-shot-'));
    await bdg(['dom', 'screenshot', path.join(dir, 'page.jpg')]);
    assert.equal(
      fs.readFileSync(path.join(dir, 'page.jpg')).subarray(0, 2).toString('hex'),
      'ffd8'
    );
    await bdg(['dom', 'screenshot', path.join(dir, 'upper.png'), '--format', 'PNG']);
    await bdg(['dom', 'screenshot', path.join(dir, 'mismatch.png'), '--format', 'jpeg'], 81);
    await bdg(['dom', 'screenshot', path.join(dir, 'anim.gif')], 81);
    await bdg(['dom', 'screenshot', path.join(dir, 'x.png'), '--format', 'gif'], 81);
    assert.equal(fs.existsSync(path.join(dir, 'mismatch.png')), false);
  });

  void it('fill toggles a controlled checkbox through its click handler', async () => {
    await bdg(['dom', 'fill', '#agree', 'true']);
    assert.equal(await evaluate("document.getElementById('agree').checked"), true);
    await bdg(['dom', 'fill', '#agree', 'false']);
    assert.equal(await evaluate("document.getElementById('agree').checked"), false);
    assert.equal(await evaluate('window.agreeState'), false);
  });

  void it('fill blurs once and refuses read-only and disabled fields', async () => {
    await takeEvents();
    await bdg(['dom', 'fill', '#name', 'hello']);
    const focusouts = (await takeEvents()).filter((event) => event === 'name:focusout');
    assert.equal(focusouts.length, 1);

    assert.match(await bdg(['dom', 'fill', '#locked', 'x'], 81), /read-only/);
    assert.match(await bdg(['dom', 'fill', '#off', 'x'], 81), /disabled/);
    assert.equal(await evaluate("document.getElementById('locked').value"), 'locked');
  });

  void it('click dispatches real pointer events', async () => {
    const output = await bdg(['dom', 'click', '#menu-trigger', '--json']);
    assert.equal((JSON.parse(output) as { data: { method: string } }).data.method, 'mouse');
    assert.equal(await evaluate("document.getElementById('menu').hidden"), false);

    const before = (await evaluate('window.submits')) as number;
    await bdg(['dom', 'click', '#submit']);
    assert.equal(await evaluate('window.submits'), before + 1);
  });

  void it('submits a form element and refuses invalid forms', async () => {
    const before = (await evaluate('window.submits')) as number;
    await evaluate(
      "document.getElementById('name').required = true; document.getElementById('name').value = ''; 1"
    );
    assert.match(await bdg(['dom', 'submit', '#form'], 81), /invalid fields/);
    assert.equal(await evaluate('window.submits'), before);

    await evaluate("document.getElementById('name').required = false; 1");
    await bdg(['dom', 'submit', '#form', '--wait-network', '0']);
    assert.equal(await evaluate('window.submits'), before + 1);
    await bdg(['dom', 'submit', '#editor'], 81);
  });

  void it('rejects inputs a user could not perform', async () => {
    assert.match(await bdg(['dom', 'pressKey', '#menu', 'a'], 81), /cannot receive keyboard focus/);
    await bdg(['dom', 'pressKey', '#name', 'a', '--modifiers', 'bogus'], 81);
    assert.match(await bdg(['dom', 'fill', '#agree', 'maybe'], 81), /Expected true or false/);
    await bdg(['dom', 'fill', '#agree', 'yes']);
    assert.equal(await evaluate("document.getElementById('agree').checked"), true);
    assert.match(await bdg(['dom', 'click', '#off'], 81), /disabled/);
  });

  void it('reports field states in dom form and uploads files', async () => {
    const output = await bdg(['dom', 'form', '--json']);
    const fields = (
      JSON.parse(output) as {
        data: {
          forms: Array<{
            fields: Array<{ selector: string; index: number; command: string; readOnly: boolean }>;
          }>;
        };
      }
    ).data.forms[0]?.fields;
    type Field = NonNullable<typeof fields>[number];
    const byId = (id: string): Field | undefined => fields?.find((f) => f.selector === `#${id}`);
    assert.equal(byId('locked')?.command, '', 'read-only field has no fill command');
    assert.equal(byId('off')?.command, '', 'disabled field has no fill command');
    const upload = byId('upload');
    assert.match(upload?.command ?? '', /fill \d+ "<path>"/);

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-upload-')), 'note.txt');
    fs.writeFileSync(file, 'hello');
    await bdg(['dom', 'fill', String(upload?.index), file]);
    assert.equal(await evaluate("document.getElementById('upload').files[0].name"), 'note.txt');
    await bdg(['dom', 'fill', '#upload', path.join(path.dirname(file), 'missing.txt')], 83);
  });
});
