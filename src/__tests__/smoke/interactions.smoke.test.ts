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
import { ELEMENT_IDENTITY_JS } from '@/runtime/dom/elementInfo.js';

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

/** Elements `dom fill` refuses: read-only editor content, inert content, a field in a disabled fieldset */
const REFUSALS_HTML =
  '<div id="ro-editor" contenteditable="false"><p>Locked</p></div>' +
  '<div inert><div id="inert-box">Inert</div></div>' +
  '<fieldset disabled><input id="fs-field"></fieldset>';

/** Three figures without text, like the-internet's hovers page */
const FIGURES_HTML =
  '<div id="figures">' +
  '<div class="figure" style="width: 20px; height: 20px"></div>'.repeat(3) +
  '</div>';

/** A visible search form, a hidden one and one in a dialog */
const SEARCH_FORMS_HTML =
  '<form id="page-search" role="search"><input type="search" name="q" id="page-q"></form>' +
  '<form id="hidden-search" role="search" style="display: none"><input type="search" name="q" id="hidden-q"></form>' +
  '<dialog id="search-dialog"><form method="dialog" role="search"><input type="search" name="q" id="dialog-q"></form></dialog>';

/**
 * A fixed app shell holding the page (with a static Drupal-style
 * `dialog-off-canvas-main-canvas` wrapper), a logout form whose only visible
 * control is its button, and a DocSearch-style raised modal overlay
 */
const FORM_SHELLS_HTML =
  '<div class="app-shell" style="position: fixed; inset: 0; overflow: auto">' +
  '<div class="dialog-off-canvas-main-canvas"><form id="drupal"><input id="drupal-q" name="q"></form></div>' +
  '<form id="shell"><input id="shell-q" name="shell"></form>' +
  '<form id="logout"><input type="hidden" name="csrf" value="x"><input name="extra" style="display: none">' +
  '<button type="submit">Log out</button></form></div>' +
  '<div class="DocSearch DocSearch-Container" style="position: fixed; inset: 0; z-index: 200">' +
  '<div class="DocSearch-Modal" style="margin: 60px auto; width: 300px; background: white">' +
  '<form class="DocSearch-Form"><input id="ds-q" type="search"></form></div></div>';

/** A heading, a field and a button named for a11y queries, and 60 links (more than a11y query lists) */
const A11Y_INDEX_HTML =
  '<h3>Welcome</h3><input id="code" aria-label="Access code">' +
  '<button id="go" onclick="window.events.push(\'go\')">Go ahead</button>' +
  Array.from({ length: 60 }, (_, i) => `<a href="#l${i}">Link ${i}</a>`).join(' ');

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

  void it('takes the element as an argument and includes floated content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-shot-'));
    const file = path.join(dir, 'floats.png');
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', '<div id="floats" style="width: 300px"><h3 style="margin: 0; height: 30px">Floats</h3>' +
        '<div style="float: left; width: 100px; height: 120px"></div><div style="float: left; width: 100px; height: 120px"></div></div>'); 1`
    );
    try {
      const output = await bdg(['dom', 'screenshot', file, '#floats', '--json']);
      const { element } = (
        JSON.parse(output) as {
          data: {
            element: {
              selector: string;
              bounds: { height: number };
              captured?: { height: number };
            };
          };
        }
      ).data;
      assert.equal(element.selector, '#floats');
      assert.equal(element.bounds.height, 30);
      assert.equal(element.captured?.height, 150);
      assert.match(
        await bdg(['dom', 'screenshot', file, '#floats']),
        /grown from 300×30 to 300×150/
      );
      await bdg(['dom', 'screenshot', file, '#floats', '--selector', '#floats']);
      await bdg(['dom', 'screenshot', file, '#floats', '--selector', 'h3'], 81);

      await evaluate("document.body.style.minHeight = '4000px'; scrollTo(0, 50); 1");
      const scrolled = JSON.parse(await bdg(['dom', 'screenshot', file, '#floats', '--json'])) as {
        data: { element: { bounds: { y: number } } };
      };
      const laidOut = JSON.parse(await bdg(['dom', 'layout', '#floats', '--json'])) as {
        data: { elements: Array<{ bounds: { y: number } }> };
      };
      assert.equal(scrolled.data.element.bounds.y, laidOut.data.elements[0]?.bounds.y);
    } finally {
      await evaluate(
        "document.getElementById('floats').remove(); document.body.style.minHeight = ''; scrollTo(0, 0); 1"
      );
    }
  });

  void it('captures the scrolled-to part of the page in a viewport screenshot', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-shot-'));
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', '<div id="tall"><div style="height: 4000px"></div><p style="font: 40px serif">' + 'Lorem ipsum dolor sit amet '.repeat(300) + '</p></div>'); 1`
    );
    /**
     * Take a viewport screenshot at a scroll position.
     *
     * @param name - File name
     * @param scroll - Script that scrolls the page
     * @returns Size of the image in bytes
     */
    const shoot = async (name: string, scroll: string): Promise<number> => {
      await evaluate(`${scroll}; 1`);
      const output = await bdg([
        'dom',
        'screenshot',
        path.join(dir, name),
        '--no-full-page',
        '--json',
      ]);
      return (JSON.parse(output) as { data: { size: number } }).data.size;
    };
    try {
      const blank = await shoot(
        'blank.png',
        "document.getElementById('tall').firstElementChild.scrollIntoView()"
      );
      const text = await shoot('text.png', 'scrollTo(0, document.documentElement.scrollHeight)');
      assert.ok(text > blank * 3, `text at the bottom: ${text} bytes, blank area: ${blank} bytes`);
    } finally {
      await evaluate("document.getElementById('tall').remove(); scrollTo(0, 0); 1");
    }
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
      /Requests during the action \(1\):\n {2}POST .*\/api\/test → 200/
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
    const submitOutput = await bdg(['dom', 'listeners', '#submit', '--type', 'submit']);
    assert.match(submitOutput, /Note: submit has no listener on the element itself/);
    assert.match(submitOutput, /^Event listeners for button#submit \(1: 1 on ancestors\)$/m);

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
      /Element: +input in label "Customer name:" \(via label\)/
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

  void it('reports the status of the navigated document, not of one its script loads', async () => {
    const url = String(await evaluate('location.href'));
    const missing = await bdg(['page', 'navigate', new URL('/missing-page', url).href]);
    assert.match(missing, /Status: +404/);
    assert.match(missing, /responded with HTTP 404/);

    const spa = await bdg(['page', 'navigate', new URL('/spa-missing', url).href, '--json']);
    const { data } = JSON.parse(spa) as { data: { status: number; warning?: string } };
    assert.equal(data.status, 404);
    assert.match(data.warning ?? '', /HTTP 404, then loaded .*\/\?\/spa-missing \(HTTP 200\)/);
    await bdg(['page', 'navigate', url]);
  });

  void it('collapses framework roots and names jQuery handlers and React props in listener lists', async () => {
    await bdg(['page', 'navigate', `${fixture.url}framework-listeners`]);
    type Listed = {
      data: {
        listeners: Array<{
          type: string;
          on: string;
          noop?: boolean;
          framework?: string;
          reactProp?: string;
          delegateSelector?: string;
          handler: { name: string; scriptId: string };
        }>;
        collapsed?: Array<{ node: string; types: string[]; count: number; capture: boolean }>;
        typeSuggestions?: string[];
      };
    };
    const listed = async (args: string[]): Promise<Listed['data']> =>
      (JSON.parse(await bdg(['dom', 'listeners', ...args, '--json'])) as Listed).data;

    const button = await listed(['#go']);
    assert.deepEqual(
      button.listeners.map((l) => `${l.type}:${l.on}:${l.noop === true}`),
      ['click:target:true']
    );
    assert.equal(button.collapsed?.length, 1);
    assert.equal(button.collapsed?.[0]?.node, 'div#root');
    assert.equal(button.collapsed?.[0]?.count, 24);
    assert.equal(button.collapsed?.[0]?.types.length, 12);
    const human = await bdg(['dom', 'listeners', '#go']);
    assert.match(
      human,
      /Framework roots.*\n {2}ancestor {2}div#root {2}React root: 12 event types, capture and bubble/
    );
    assert.match(
      human,
      /Note: React's root container \(div#root\) handles click, .*but no React on… prop .*; the element's own click listener is only React's no-op placeholder/
    );
    assert.equal((await listed(['#go', '--all'])).listeners.length, 25);

    const row = await listed(['#row', '--type', 'click']);
    const jquery = row.listeners.filter((l) => l.framework === 'jQuery');
    assert.deepEqual(
      jquery.map((l) => `${l.on}:${l.handler.name}:${l.delegateSelector}`),
      ['document:rowClicked:.row']
    );

    assert.deepEqual((await listed(['#row', '--type', 'Click'])).typeSuggestions, ['click']);

    const buy = await listed(['#buy']);
    assert.deepEqual(
      buy.listeners.map((l) => `${l.type}:${l.on}:${l.reactProp ?? (l.noop ? 'no-op' : '')}`),
      ['click:target:onClick', 'click:target:no-op', 'keydown:ancestor:onKeyDownCapture']
    );
    const [handleBuy] = buy.listeners;
    assert.equal(handleBuy?.framework, 'React');
    assert.equal(handleBuy?.handler.name, 'handleBuy');
    assert.notEqual(handleBuy?.handler.scriptId, '0', 'has a location');
    const buyHuman = await bdg(['dom', 'listeners', '#buy']);
    assert.match(
      buyHuman,
      /\n\nclick\n {2}target .* handleBuy .*\[React onClick\] function handleBuy/
    );
    assert.match(
      buyHuman,
      /Note: the element's own click listener is only React's no-op placeholder; the React on… handlers listed above for click run/
    );
  });

  void it('reports a fill the page moved, and form readiness by group and required field', async () => {
    await bdg(['page', 'navigate', `${fixture.url}forms`]);
    type Summary = { totalFields: number; filledFields: number; readyToSubmit: boolean };
    type Discovered = {
      data: {
        forms: Array<{ summary: Summary; buttons: Array<{ label: string; primary: boolean }> }>;
      };
    };
    const discover = async (): Promise<Discovered['data']['forms'][number] | undefined> =>
      (JSON.parse(await bdg(['dom', 'form', '--json'])) as Discovered).data.forms[0];

    const untouched = await discover();
    assert.equal(untouched?.summary.totalFields, 5, 'radio and checkbox groups count once');
    assert.equal(untouched?.summary.readyToSubmit, false);
    assert.deepEqual(
      untouched?.buttons.map((b) => `${b.label}:${b.primary}`),
      ['Cancel:false', 'Continue:true']
    );
    assert.match(
      await bdg(['dom', 'form']),
      /0\/5 fields filled \| 3 required fields empty: First Name, Last Name, Zip \| NOT ready/
    );

    await bdg(['dom', 'fill', '#first', 'Ada']);
    const moved = await bdg(['dom', 'fill', '#last', 'Lovelace']);
    assert.match(
      moved,
      /^⚠ Element Filled \(with warnings\)\n⚠ Warning: The field's value is "" after filling \(expected "Lovelace"\); the value appeared in input#first instead\n/
    );
    await bdg(['dom', 'fill', '#first', 'Ada']);
    const movedJson = JSON.parse(await bdg(['dom', 'fill', '#last', 'Lovelace', '--json'])) as {
      data: { valueMismatch?: { expected: string; actual: string; movedTo?: string } };
    };
    assert.deepEqual(movedJson.data.valueMismatch, {
      expected: 'Lovelace',
      actual: '',
      movedTo: 'input#first',
    });
    assert.match(await bdg(['dom', 'fill', '#zip', '12345']), /^✓ Element Filled\n/);

    assert.match(
      await bdg(['dom', 'form']),
      /2\/5 fields filled \| 1 required field empty: Last Name \| NOT ready/
    );
    await bdg(['dom', 'fill', 'input[name=size][value=l]', 'true']);
    assert.equal((await discover())?.summary.filledFields, 3);
  });

  void it('names the element an action hit and puts warnings before the details', async () => {
    await bdg(['dom', 'query', '.toggle']);
    assert.match(await bdg(['dom', 'click', '1']), /Element: +input\.toggle in li "Buy milk"/);
    const first = await bdg(['dom', 'click', '.toggle']);
    assert.match(first, /^⚠ Element Clicked \(with warnings\)\n⚠ Warning: 2 elements match/);
    assert.match(first, /Element: +input\.toggle in li "Write report"/);
    assert.match(
      await bdg(['dom', 'click', '#behind']),
      /^⚠ Element Clicked \(no visible effect observed: no DOM change, requests or navigation within 300 ms\)\n⚠ Warning: Element is covered by another element/
    );
    assert.match(
      await bdg(['dom', 'click', '#cancel']),
      /^⚠ Element Clicked \(no visible effect observed: no DOM change, requests or navigation within 300 ms\)\n\nSelector: +#cancel\nElement: +button#cancel\.btn\.btn_secondary "Cancel"/
    );
  });

  void it('names a select by its label or selected option, not its options run together', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', '<span id="sorts"><span>Name (A to Z)</span><select class="sort" aria-label="Sort products"><option value="az">Name (A to Z)</option><option value="za">Name (Z to A)</option></select>' +
        '<span>Size</span><select class="bare"><option>Small</option><option>Large</option></select><input type="checkbox" class="pick"></span>'); 1`
    );
    try {
      assert.match(
        await bdg(['dom', 'fill', '.sort', 'za']),
        /Element: +select\.sort "Sort products"/
      );
      assert.match(await bdg(['dom', 'fill', '.bare', 'Large']), /Element: +select\.bare "Large"/);
      assert.match(
        await bdg(['dom', 'click', '.pick']),
        /Element: +input\.pick in span#sorts "Name \(A to Z\) Size"/
      );
    } finally {
      await evaluate("document.getElementById('sorts').remove(); 1");
    }
  });

  void it('names a select by label, then aria-label, then name, then selected option', async () => {
    const options = '<option>One</option><option selected>Two</option>';
    const html =
      `<div id="naming"><label for="s1">By label</label><select id="s1" aria-label="Aria" name="n1">${options}</select>` +
      `<select id="s2" aria-label="By aria" name="n2">${options}</select>` +
      `<select id="s3" name="by-name">${options}</select>` +
      `<select id="s4">${options}</select>` +
      `<p><span>Row</span><span style="display:none">Gone</span><span style="visibility:hidden">Ghost</span>` +
      `<select>${options}</select><textarea>typed</textarea><input type="checkbox" class="row-pick"></p></div>`;
    await evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); 1`);
    try {
      const names = await evaluate(
        `['#s1', '#s2', '#s3', '#s4', '.row-pick'].map((s) => (${ELEMENT_IDENTITY_JS})(document.querySelector(s)))`
      );
      assert.deepEqual(names, [
        'select#s1 "By label"',
        'select#s2 "By aria"',
        'select#s3 "by-name"',
        'select#s4 "Two"',
        'input.row-pick in p "Row"',
      ]);
    } finally {
      await evaluate("document.getElementById('naming').remove(); 1");
    }
  });

  void it('lists API requests and sums up assets after an action', async () => {
    const human = await bdg(['dom', 'click', '#load-assets']);
    assert.match(
      human,
      /Requests during the action \(3\):\n {2}GET .*\/api\/test → 200.*\n {2}\+ 2 assets \(css, images\)/
    );
    const json = JSON.parse(await bdg(['dom', 'click', '#load-assets', '--json'])) as Triggered;
    assert.deepEqual(json.data.triggeredRequests?.map((r) => r['resourceType']).sort(), [
      'Fetch',
      'Image',
      'Stylesheet',
    ]);
  });

  void it('fills a select whose change handler navigates away', async () => {
    await bdg(['page', 'navigate', `${fixture.url}forms`]);
    const filled = await bdg(['dom', 'fill', '#jump-to', 'b']);
    assert.match(filled, /^✓ Element Filled\n/);
    assert.match(String(await evaluate('location.href')), /\/forms-jumped\?to=b$/);
  });

  void it('says when a click had no visible effect, and what a click changed', async () => {
    await bdg(['page', 'navigate', `${fixture.url}forms`]);
    type Effects = {
      data: {
        effect?: string;
        navigation?: { url: string; sameDocument: boolean; status?: number };
        messages?: Array<{ text: string; element: string }>;
      };
    };
    const click = async (selector: string): Promise<Effects['data']> =>
      (JSON.parse(await bdg(['dom', 'click', selector, '--json'])) as Effects).data;

    assert.match(
      await bdg(['dom', 'click', '#broken']),
      /^⚠ Element Clicked \(no visible effect observed: no DOM change, requests or navigation within 300 ms\)\n/
    );
    assert.equal((await click('#broken')).effect, 'none');
    assert.equal(
      (await click('#add')).effect,
      undefined,
      'a button changing its text has an effect'
    );

    assert.match(
      await bdg(['dom', 'click', '#validate']),
      /^✓ Element Clicked\n[\s\S]*\nNew text: +"Zip is required" \(p#form-error\.error\)\n/
    );
    assert.equal((await click('#validate')).messages, undefined, 'the same text is not new again');

    for (const selector of ['#mail', '#copy', '#attach']) {
      assert.equal(
        (await click(selector)).effect,
        undefined,
        `${selector} is not claimed as no effect`
      );
    }

    const hash = await click('#filter-active');
    assert.deepEqual(hash.navigation, { url: `${fixture.url}forms#/active`, sameDocument: true });
    assert.equal(hash.effect, undefined);
  });

  void it('waits for a form POST that redirects back to its own URL and shows its flash', async () => {
    await bdg(['page', 'navigate', `${fixture.url}login`]);
    await bdg(['dom', 'fill', '#username', 'tom']);
    await bdg(['dom', 'fill', '#password', 'wrong']);
    const failed = await bdg(['dom', 'submit', '#login', '--wait-navigation', '--timeout', '5000']);
    assert.match(failed, /\nPage: +navigated to http:\/\/127\.0\.0\.1:\d+\/login \(200\)\n/);
    assert.match(
      failed,
      /\nNew text: +"Your password is invalid!" \(div#flash\.flash\.error\)\n/,
      'the × close link is left out'
    );

    await bdg(['dom', 'fill', '#password', 'secret']);
    const json = JSON.parse(await bdg(['dom', 'click', 'button', '--json'])) as {
      data: { navigation?: unknown; messages?: unknown };
    };
    assert.deepEqual(json.data.navigation, {
      url: `${fixture.url}secure`,
      sameDocument: false,
      status: 200,
    });
    assert.deepEqual(json.data.messages, [
      { text: 'You logged into a secure area!', element: 'div#flash.flash.success' },
    ]);
  });

  void it('names why an element cannot be filled', async () => {
    await bdg(['page', 'navigate', `${fixture.url}interactions`]);
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(REFUSALS_HTML)}); 1`
    );
    assert.match(
      await bdg(['dom', 'fill', '#ro-editor p', 'x'], 81),
      /The element is read-only \(contenteditable="false" on div#ro-editor\)/
    );
    assert.match(await bdg(['dom', 'fill', '#inert-box', 'x'], 81), /The element is inert/);
    assert.match(
      await bdg(['dom', 'fill', '#fs-field', 'x'], 81),
      /The element is disabled \(inside a disabled <fieldset>\)/
    );
  });

  void it('describes an element without text by its position among its siblings', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(FIGURES_HTML)}); 1`
    );
    assert.match(
      await bdg(['dom', 'hover', '.figure', '--index', '1']),
      /Element: +div\.figure \(2nd of 3\)/
    );
  });

  void it('lists forms in an open dialog first, marks hidden ones and warns when filling them', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(SEARCH_FORMS_HTML)}); document.getElementById('search-dialog').showModal(); 1`
    );
    type Listed = {
      data: {
        forms: Array<{
          name: string;
          hidden: boolean;
          inDialog: boolean;
          fields: Array<{ index: number; selector: string; hidden: boolean }>;
        }>;
      };
    };
    const { forms } = (JSON.parse(await bdg(['dom', 'form', '--all', '--json'])) as Listed).data;
    const formOf = (selector: string): Listed['data']['forms'][number] | undefined =>
      forms.find((form) => form.fields.some((field) => field.selector === selector));
    assert.equal(forms[0]?.inDialog, true, JSON.stringify(forms));
    assert.deepEqual(
      forms[0]?.fields.map((f) => [f.index, f.selector]),
      [[0, '#dialog-q']]
    );
    const hidden = formOf('#hidden-q');
    assert.equal(hidden, forms.at(-1), 'hidden forms come last');
    assert.equal(hidden?.hidden, true);
    assert.equal(hidden?.fields[0]?.hidden, true);
    assert.equal(formOf('#page-q')?.hidden, false);
    const human = await bdg(['dom', 'form', '--all']);
    assert.match(human, /Form: "Search" \(in dialog\)/);
    assert.match(human, /Form: "Search" \(hidden\)/);
    assert.match(human, /^ +\d+ +search +\S+ +empty +hidden$/m);

    assert.match(await bdg(['dom', 'fill', '0', 'hooks']), /^✓ Element Filled/);
    assert.equal(await evaluate("document.getElementById('dialog-q').value"), 'hooks');
    assert.match(
      await bdg(['dom', 'fill', String(formOf('#page-q')?.fields[0]?.index), 'x']),
      /behind an open modal dialog/
    );
    await evaluate("document.getElementById('search-dialog').close(); 1");
    assert.match(
      await bdg(['dom', 'fill', String(hidden?.fields[0]?.index), 'x']),
      /The field is hidden; a user could not fill it/
    );
  });

  void it('keeps forms with only a button visible and tells dialogs from app shells', async () => {
    await evaluate(`document.body.innerHTML = ${JSON.stringify(FORM_SHELLS_HTML)}; 1`);
    type Listed = {
      data: {
        forms: Array<{ hidden: boolean; inDialog: boolean; fields: Array<{ selector: string }> }>;
      };
    };
    const { forms } = (JSON.parse(await bdg(['dom', 'form', '--all', '--json'])) as Listed).data;
    const formOf = (selector: string): Listed['data']['forms'][number] | undefined =>
      forms.find((form) => form.fields.some((field) => field.selector === selector));
    assert.equal(formOf('#ds-q')?.inDialog, true, 'a raised fixed overlay (DocSearch) is a dialog');
    assert.equal(forms[0], formOf('#ds-q'), 'the dialog form comes first');
    assert.equal(formOf('#shell-q')?.inDialog, false, 'a fixed app shell is not a dialog');
    assert.equal(formOf('#drupal-q')?.inDialog, false, 'a static "dialog-…" wrapper is not one');
    assert.equal(
      formOf('input[name="extra"]')?.hidden,
      false,
      'a form with a visible button is shown'
    );
  });

  void it('acts on a11y query indices and says which list an index refers to', async () => {
    await evaluate(`document.body.innerHTML = ${JSON.stringify(A11Y_INDEX_HTML)}; 1`);
    await takeEvents();
    await bdg(['dom', 'a11y', 'query', 'role:button name:Go ahead']);
    const click = await bdg(['dom', 'click', '0']);
    assert.match(
      click,
      /^Element: +button#go "Go ahead" \(index 0 of the last dom a11y query "role:button name:Go ahead"\)$/m
    );
    assert.doesNotMatch(click, /^Selector:/m);
    assert.deepEqual(await takeEvents(), ['go']);

    await bdg(['dom', 'a11y', 'query', 'role:textbox name:Access code']);
    assert.match(await bdg(['dom', 'fill', '0', '1234']), /^✓ Element Filled/);
    assert.equal(await evaluate("document.getElementById('code').value"), '1234');

    await bdg(['dom', 'query', 'h3']);
    const wrongList = await bdg(['dom', 'fill', '0', 'x'], 81);
    assert.match(
      wrongList,
      /index 0 refers to the last dom query results \("h3": h3 "Welcome"\); run bdg dom form to target form fields by index/
    );

    await bdg(['dom', 'a11y', 'query', 'role:button name:Go ahead']);
    await evaluate("document.getElementById('go').remove(); 1");
    const stale = await bdg(['dom', 'click', '0'], 87);
    assert.match(
      stale,
      /element at index 0 of the last dom a11y query "role:button name:Go ahead"/
    );
    assert.doesNotMatch(stale, /__bdg_bound_target__|querySelector/);
  });

  void it('lists a11y matches once each, up to --limit (all in JSON by default)', async () => {
    const links = await bdg(['dom', 'a11y', 'query', 'role:link']);
    assert.match(links, /^\[49\] \[Link\] "Link 49"/m);
    assert.doesNotMatch(links, /^\[50\]/m);
    assert.match(links, /\.\.\. and 10 more \(--limit 0 lists all; their indices work too\)/);
    type Listed = { data: { count: number; nodes: unknown[]; omitted?: number } };
    const json = async (args: string[]): Promise<Listed['data']> =>
      (JSON.parse(await bdg(['dom', 'a11y', 'query', 'role:link', '--json', ...args])) as Listed)
        .data;
    const all = await json([]);
    assert.equal(all.count, 60);
    assert.equal(all.nodes.length, 60, 'JSON lists all matches without --limit');
    const limited = await json(['--limit', '5']);
    assert.equal(limited.nodes.length, 5);
    assert.equal(limited.omitted, 55);
    assert.match(await bdg(['dom', 'get', '55']), /\[Link\] "Link 55"/);
  });

  void it('dom get takes --index (and --nth), and reads the body without a selector', async () => {
    assert.match(await bdg(['dom', 'get', 'a', '--index', '2']), /^\[Link\] "Link 2"/);
    assert.match(await bdg(['dom', 'get', 'a', '--nth', '3']), /^\[Link\] "Link 3"/);
    assert.match(await bdg(['dom', 'get', 'a', '--index', '1', '--raw']), /href="#l1"/);
    assert.match(await bdg(['dom', 'get', '0', '--index', '1'], 81), /already an index/);
    assert.match(await bdg(['dom', 'get']), /Link 0/);
    await evaluate("document.body.innerHTML = '<iframe></iframe>'; 1");
    assert.match(
      await bdg(['dom', 'get']),
      /No text; holds 1 element: iframe \(see its HTML with --raw\)/
    );
  });

  void it('says nothing scrolled on a page no taller than the viewport', async () => {
    const output = await bdg(['dom', 'scroll', '--bottom']);
    assert.match(output, /^⚠ Page Scrolled \(with warnings\)/);
    assert.match(output, /Nothing to scroll: the document is no taller than the viewport/);
    assert.doesNotMatch(output, /still loading/);
  });

  void it('clicks, fills and measures a11y matches in bordered and scaled cross-origin iframes', async () => {
    type Layout = {
      data: {
        elements: Array<{ bounds: { x: number; y: number; width: number; height: number } }>;
      };
    };
    const port = new URL(fixture.url).port;
    await bdg(['page', 'navigate', `http://a.b.localhost:${port}/cross-frame`]);
    await bdg(['dom', 'wait', '#scaled', '--load']);
    const bounds = async (): Promise<{ x: number; y: number; width: number; height: number }> => {
      const output = await bdg(['dom', 'layout', '0', '--json']);
      const [element] = (JSON.parse(output) as Layout).data.elements;
      assert.ok(element, output);
      return element.bounds;
    };

    await bdg(['dom', 'a11y', 'query', 'role:button name:Accept plain']);
    const plain = await bounds();
    assert.equal(plain.x, 8 + 150 + 4 + 10 + 90, 'margin, border and padding are included');
    assert.match(await bdg(['dom', 'click', '0']), /Method: +mouse events/);

    await bdg(['dom', 'a11y', 'query', 'role:button name:Accept scaled']);
    const scaled = await bounds();
    assert.ok(Math.abs(scaled.x - (8 + 150 + (6 + 8 + 90) / 2)) <= 1, JSON.stringify(scaled));
    assert.ok(Math.abs(scaled.height - plain.height / 2) <= 1, JSON.stringify({ plain, scaled }));
    const click = await bdg(['dom', 'click', '0']);
    assert.match(click, /Method: +mouse events/);
    assert.doesNotMatch(click, /may not have reached/);

    await bdg(['dom', 'a11y', 'query', 'role:textbox name:Code scaled']);
    await bdg(['dom', 'fill', '0', 'xyz']);
    assert.deepEqual(await evaluate('window.events'), [
      'accepted:plain',
      'accepted:scaled',
      'code:scaled:xyz',
    ]);
  });
});
