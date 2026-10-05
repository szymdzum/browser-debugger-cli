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

const LABELS_HTML =
  '<form id="labels" onsubmit="return false"><label>Customer name: <input name="custname"></label>' +
  '<label for="em">E-mail address:</label><input id="em" type="email">' +
  '<label><input type="checkbox" id="agree"> I agree</label>' +
  '<label id="orphan">Orphan note</label>' +
  '<label id="fancy">Fancy <input type="checkbox" id="fancybox" style="opacity:0;position:absolute"><span>box</span></label>' +
  '<label>Avatar <input type="file" id="avatar"></label></form>';

/** JSON output of a DOM action */
type Triggered = { data: { triggeredRequests?: Array<Record<string, unknown>> } };

/**
 * Find a request an action reported by the end of its URL.
 *
 * @param output - JSON output of the action
 * @param urlEnd - End of the request's URL
 * @returns The request, if listed
 */
function triggeredRequest(output: string, urlEnd: string): Record<string, unknown> | undefined {
  return (JSON.parse(output) as Triggered).data.triggeredRequests?.find((r) =>
    String(r['url']).endsWith(urlEnd)
  );
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

  void it('reports the network requests a click triggered', async () => {
    const clicked = JSON.parse(await bdg(['dom', 'click', '#load', '--json'])) as Triggered;
    const request = clicked.data.triggeredRequests?.find((r) =>
      String(r['url']).endsWith('/api/test')
    );
    assert.equal(request?.['method'], 'POST', JSON.stringify(clicked.data.triggeredRequests));
    assert.equal(request?.['status'], 200);
    assert.equal(typeof request?.['durationMs'], 'number');
    assert.match(
      await bdg(['dom', 'click', '#load']),
      /Requests during the action:\n {2}POST .*\/api\/test → 200/
    );

    const filled = JSON.parse(await bdg(['dom', 'fill', '#name', 'quiet', '--json'])) as Triggered;
    assert.deepEqual(filled.data.triggeredRequests, []);
  });

  void it('waits for a request the handler starts, but not for a slow navigation', async () => {
    const delayed = await bdg(['dom', 'click', '#load-delayed', '--json']);
    const request = triggeredRequest(delayed, '/api/delayed');
    assert.equal(request?.['status'], 200, delayed);
    assert.equal(request?.['pending'], undefined, delayed);

    const url = String(await evaluate('location.href'));
    const started = Date.now();
    const navigating = await bdg(['dom', 'click', '#navigate-slow', '--json']);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 4000, `click returned after ${elapsed}ms`);
    assert.equal(triggeredRequest(navigating, '/slow')?.['pending'], true, navigating);
    await bdg(['page', 'navigate', url]);
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

    await evaluate("document.getElementById('submit').disabled = true; 1");
    assert.match(await bdg(['dom', 'submit', '#form'], 81), /submit button is disabled/);
    await evaluate("document.getElementById('submit').disabled = false; 1");
    assert.equal(await evaluate('window.submits'), before + 1);
  });

  void it('warns when acting on a field a user could not reach or on one of many', async () => {
    const warning = async (args: string[]): Promise<string | undefined> =>
      (JSON.parse(await bdg([...args, '--json'])) as { data: { warning?: string } }).data.warning;

    await evaluate("document.getElementById('name').hidden = true; 1");
    assert.match((await warning(['dom', 'fill', '#name', 'x'])) ?? '', /hidden/);
    await evaluate("document.getElementById('name').hidden = false; 1");
    assert.equal(await warning(['dom', 'fill', '#name', 'x']), undefined);
    assert.match((await warning(['dom', 'scroll', 'input'])) ?? '', /elements match/);
    assert.equal(await warning(['dom', 'scroll', 'input', '--index', '1']), undefined);
    await bdg(['dom', 'hover', '#off']);
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
    await bdg(['dom', 'fill', '#upload', path.dirname(file)], 81);
    await bdg(['dom', 'fill', '#upload', '']);
    assert.equal(await evaluate("document.getElementById('upload').files.length"), 0);
  });

  void it('keeps the previous value when the browser would change the given one', async () => {
    await evaluate(
      'document.body.insertAdjacentHTML(\'beforeend\', \'<input id="hue" type="color" value="#112233"><input id="level" type="range" min="0" max="10" value="3"><input id="qty" type="number" max="10"><fieldset disabled><input id="inset"></fieldset>\'); 1'
    );
    assert.match(await bdg(['dom', 'fill', '#hue', 'notacolor'], 81), /rejected/);
    assert.equal(await evaluate("document.getElementById('hue').value"), '#112233');
    assert.match(await bdg(['dom', 'fill', '#level', '70'], 81), /would set 10/);
    assert.equal(await evaluate("document.getElementById('level').value"), '3');
    assert.match(await bdg(['dom', 'fill', '#qty', '50']), /outside the allowed range/);
    assert.match(await bdg(['dom', 'fill', '#inset', 'x'], 81), /disabled/);
  });

  void it('types at the end of a prefilled field', async () => {
    await bdg(['dom', 'fill', '#name', 'hello']);
    await bdg(['dom', 'pressKey', '#name', 'x']);
    assert.equal(await evaluate("document.getElementById('name').value"), 'hellox');
  });

  void it('reports dialogs and what covers a click target', async () => {
    await evaluate(
      'document.body.insertAdjacentHTML(\'beforeend\', \'<button id="alerting" onclick="alert(&quot;Saved&quot;)">A</button><div style="position:relative"><button id="hidden-behind">B</button><div id="shield" style="position:absolute;inset:0"></div></div>\'); 1'
    );
    const clicked = JSON.parse(await bdg(['dom', 'click', '#alerting', '--json'])) as {
      data: { dialogs?: Array<{ type: string; message: string }> };
    };
    assert.deepEqual(clicked.data.dialogs, [{ type: 'alert', message: 'Saved' }]);
    assert.match(
      await bdg(['dom', 'click', '#hidden-behind']),
      /covered by another element \(div#shield\)/
    );
  });

  void it('double-clicks, right-clicks and hovers with real mouse events', async () => {
    await evaluate(
      "document.body.insertAdjacentHTML('beforeend', '<button id=\"pointer\">P</button><select id=\"many\" multiple><option>a</option><option>b</option><option>c</option></select>'); window.pointer = []; ['dblclick', 'contextmenu', 'mouseover'].forEach((type) => document.getElementById('pointer').addEventListener(type, (e) => window.pointer.push(type + (e.isTrusted ? '' : ':synthetic')))); 1"
    );
    await bdg(['dom', 'click', '#pointer', '--double']);
    await bdg(['dom', 'click', '#pointer', '--right']);
    await bdg(['dom', 'hover', '#pointer']);
    const seen = (await evaluate('window.pointer')) as string[];
    for (const type of ['dblclick', 'contextmenu', 'mouseover'])
      assert.ok(seen.includes(type), type);
    await bdg(['dom', 'click', '#pointer', '--double', '--right'], 81);

    await bdg(['dom', 'fill', '#many', 'a,c']);
    assert.deepEqual(
      await evaluate("Array.from(document.getElementById('many').selectedOptions, (o) => o.value)"),
      ['a', 'c']
    );
  });

  void it('lists the event listeners of an element and its ancestors', async () => {
    type Listed = {
      data: {
        index?: number;
        element: string;
        listeners: Array<{ type: string; on: string; node: string; handler: { name: string } }>;
      };
    };
    const listed = async (args: string[]): Promise<Listed['data']> =>
      (JSON.parse(await bdg(['dom', 'listeners', ...args, '--json'])) as Listed).data;

    const own = await listed(['#agree', '--type', 'click,change']);
    assert.equal(own.element, 'input#agree');
    assert.ok(own.listeners.every((l) => l.on === 'target' && l.node === 'input#agree'));
    assert.ok(own.listeners.some((l) => l.type === 'click' && l.handler.name === 'log'));
    assert.deepEqual([...new Set(own.listeners.map((l) => l.type))], ['change', 'click']);

    const submit = await listed(['#submit', '--type', 'submit']);
    assert.deepEqual(
      submit.listeners.map((l) => `${l.on}:${l.node}`),
      ['ancestor:form#form']
    );
    assert.match(
      await bdg(['dom', 'listeners', '#submit', '--type', 'submit']),
      /Note: submit has no listener on the element itself/
    );

    await bdg(['dom', 'query', '#menu-trigger']);
    const cached = await listed(['0', '--type', 'pointerdown']);
    assert.equal(cached.index, 0);
    assert.deepEqual(
      cached.listeners.map((l) => `${l.type}:${l.on}`),
      ['pointerdown:target']
    );
    await bdg(['dom', 'listeners', '#missing'], 83);
  });

  void it('acts on the control a <label> stands for', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(LABELS_HTML)}); 1`
    );
    assert.match(
      await bdg(['dom', 'fill', 'label:has-text("Customer name")', 'Ada']),
      /input \(via label\)/
    );
    assert.equal(await evaluate("document.querySelector('[name=custname]').value"), 'Ada');
    await bdg(['dom', 'fill', 'label:has-text("Customer name") input', 'Bob']);
    assert.equal(await evaluate("document.querySelector('[name=custname]').value"), 'Bob');
    await bdg(['dom', 'pressKey', 'label[for=em]', 'a']);
    assert.equal(await evaluate("document.getElementById('em').value"), 'a');
    const click = JSON.parse(
      await bdg(['dom', 'click', 'label:has-text("I agree")', '--json'])
    ) as { data: { elementType: string } };
    assert.equal(click.data.elementType, 'input (via label)');
    assert.equal(await evaluate("document.getElementById('agree').checked"), true);
    const orphan = await bdg(['dom', 'fill', '#orphan', 'x'], 81);
    assert.match(orphan, /not associated with a form control/);
    assert.match(orphan, /a11y query 'name=Orphan note'/);
  });

  void it('clicks the label of a transparent control, and uploads through a label', async () => {
    const click = JSON.parse(await bdg(['dom', 'click', '#fancy', '--json'])) as {
      data: { elementType: string };
    };
    assert.equal(click.data.elementType, 'label');
    assert.equal(await evaluate("document.getElementById('fancybox').checked"), true);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-upload-')), 'avatar.txt');
    fs.writeFileSync(file, 'x');
    try {
      const fill = JSON.parse(
        await bdg(['dom', 'fill', 'label:has-text("Avatar")', file, '--json'])
      ) as { data: { elementType: string; value: string } };
      assert.equal(fill.data.elementType, 'input (via label)');
      assert.equal(
        await evaluate("document.getElementById('avatar').files[0]?.name"),
        'avatar.txt'
      );
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  void it('finds an a11y name with spaces and a colon', async () => {
    const output = await bdg(['dom', 'a11y', 'query', 'name=E-mail address:', '--json']);
    const { data } = JSON.parse(output) as { data: { nodes: Array<{ role: string }> } };
    assert.ok(
      data.nodes.some((node) => node.role === 'textbox'),
      output
    );
    await bdg(['dom', 'a11y', 'query', 'role=textbox name=E-mail address:']);
  });

  void it('navigates the page and its history', async () => {
    const url = String(await evaluate('location.href'));
    const other = new URL('/', url).href;
    assert.match(await bdg(['page', 'navigate', other]), /Navigated/);
    assert.equal(await evaluate('location.href'), other);
    assert.match(await bdg(['page', 'back']), /Went back/);
    assert.equal(await evaluate('location.href'), url);
    await bdg(['page', 'forward']);
    await bdg(['page', 'forward'], 81);
    await bdg(['page', 'back']);
  });
});
