/**
 * Element targeting smoke test.
 *
 * Indices from `dom query` / `dom form` must keep addressing the exact element
 * they listed: other elements appearing, selector-based commands in between,
 * or same-name radio buttons must not redirect them, and an element that is
 * gone (removed, or the page navigated) must fail with exit 87 instead of
 * silently acting on whatever matches now.
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

const LIST_HTML =
  '<ul id="list">' +
  ['one', 'two', 'three']
    .map((t) => `<li class="item" onclick="window.hit='${t}'">${t}</li>`)
    .join('') +
  '</ul>' +
  '<form id="sizes"><label>S<input type="radio" name="size" value="s"></label>' +
  '<label>M<input type="radio" name="size" value="m"></label>' +
  '<label>L<input type="radio" name="size" value="l"></label></form>';

const VISIBILITY_HTML =
  '<ul id="shown"><li>shown</li><li style="display:none">gone</li>' +
  '<li style="visibility:hidden">invisible</li></ul>';

/**
 * Text previews of the elements a selector matches.
 *
 * @param selector - Selector for `dom query`
 * @returns Previews in match order
 */
async function queryPreviews(selector: string): Promise<string[]> {
  const output = await bdg(['dom', 'query', selector, '--json']);
  const data = JSON.parse(output) as { data: { nodes: Array<{ preview?: string }> } };
  return data.data.nodes.map((node) => node.preview ?? '');
}

void describe('Element targeting', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}interactions`, '--port', String(port), '--headless']);
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(LIST_HTML)}); 1`
    );
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('keeps clicking the queried element after the DOM changes', async () => {
    await bdg(['dom', 'query', '.item']);
    await evaluate(
      `document.getElementById('list').insertAdjacentHTML('afterbegin', '<li class="item" onclick="window.hit=\\'new\\'">new</li>'); 1`
    );
    await bdg(['dom', 'click', '0']);
    assert.equal(await evaluate('window.hit'), 'one');
  });

  void it('keeps indices valid across selector-based commands', async () => {
    await bdg(['dom', 'query', '.item']);
    await bdg(['dom', 'get', 'h1'], 83);
    await bdg(['dom', 'get', '#form']);
    assert.match(await bdg(['dom', 'get', '1']), /one/);
  });

  void it('fails with 87 for an element that was removed', async () => {
    await bdg(['dom', 'query', '.item']);
    await evaluate("document.querySelector('.item').remove(); 1");
    assert.match(await bdg(['dom', 'click', '0'], 87), /no longer in the page/);
    await bdg(['dom', 'get', '0'], 87);
    await bdg(['dom', 'get', '1']);
  });

  void it('fills the right radio button from dom form indices', async () => {
    const output = await bdg(['dom', 'form', '--all', '--json']);
    const data = JSON.parse(output) as {
      data: { forms: Array<{ fields: Array<{ index: number; selector: string }> }> };
    };
    const fields = data.data.forms.flatMap((form) => form.fields);
    const medium = fields.find((field) => field.selector.includes('"m"'));
    assert.ok(medium, `radio fields: ${JSON.stringify(fields.map((f) => f.selector))}`);
    await bdg(['dom', 'fill', String(medium.index), 'true']);
    assert.equal(await evaluate("document.querySelector('[name=size]:checked')?.value"), 'm');
  });

  void it('clicks by text with :has-text()', async () => {
    const before = Number(await evaluate('window.submits'));
    await bdg(['dom', 'click', 'button:has-text("send")']);
    assert.equal(await evaluate('window.submits'), before + 1);
  });

  void it('filters matches with :visible, :text-is() and selector lists', async () => {
    await evaluate(
      `document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(VISIBILITY_HTML)}); 1`
    );
    assert.deepEqual(await queryPreviews('#shown li:visible'), ['shown']);
    assert.deepEqual(
      await queryPreviews('#shown li:text-is("Shown"), #menu-trigger:has-text("MENU")'),
      ['Menu']
    );
    assert.deepEqual(await queryPreviews('#shown li:text-is("shown"), #shown li:visible'), [
      'shown',
    ]);
  });

  void it('rejects text and visibility filters that are not at the end with 81', async () => {
    const output = await bdg(['dom', 'click', 'form:has-text("Send") button'], 81);
    assert.match(output, /must come last/);
    await bdg(['dom', 'query', 'li:visible a'], 81);
  });

  void it('fails with 87 after the page navigated', async () => {
    await bdg(['dom', 'query', '.item']);
    await evaluate('location.href = location.href; 1');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await bdg(['dom', 'get', '0'], 87);
    await bdg(['dom', 'click', '0'], 87);
  });
});

/** The `data` of `dom layout --json` (the fields the tests read). */
interface LayoutData {
  count: number;
  page: { viewport: { height: number }; document: { height: number } };
  elements: Array<{
    index: number;
    context?: string;
    bounds: { x: number; y: number; width: number; height: number };
    inViewport: string;
    hiddenReason?: string;
    scrollBy?: { x: number; y: number };
    coveredBy?: string;
  }>;
}

/**
 * Layout of the elements an argument refers to.
 *
 * @param args - Selector or index, then options
 * @returns Layout data
 */
async function layout(...args: string[]): Promise<LayoutData> {
  const output = await bdg(['dom', 'layout', ...args, '--json']);
  return (JSON.parse(output) as { data: LayoutData }).data;
}

void describe('Element layout', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}layout`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports an element below the fold with page coordinates and the scroll to it', async () => {
    const data = await layout('#save');
    const [save] = data.elements;
    assert.deepEqual(save?.bounds, { x: 20, y: 2000, width: 120, height: 40 });
    assert.equal(save?.inViewport, 'below');
    assert.equal(save?.scrollBy?.y, 2040 - data.page.viewport.height);
    assert.ok(data.page.document.height >= 3000);
    assert.match(
      await bdg(['dom', 'layout', '#save']),
      /20,2000 120×40 {2}below fold \(scroll down \d+px\)/
    );
  });

  void it('names the element covering another, and none for an uncovered one', async () => {
    const data = await layout('#top, #covered');
    assert.deepEqual(
      data.elements.map((element) => [element.inViewport, element.coveredBy]),
      [
        ['visible', undefined],
        ['visible', 'div#overlay'],
      ]
    );
  });

  void it('reports no cover where hit-testing passes through or a link wraps', async () => {
    const data = await layout('#click-through, #under-glass, #wrapped');
    assert.deepEqual(
      data.elements.map((element) => [element.inViewport, element.coveredBy]),
      [
        ['visible', undefined],
        ['visible', undefined],
        ['visible', undefined],
      ]
    );
  });

  void it('does not clip an absolutely positioned dropdown by a static overflow parent', async () => {
    const [dropdown] = (await layout('#dropdown')).elements;
    assert.equal(dropdown?.inViewport, 'visible', JSON.stringify(dropdown));
  });

  void it('says why a hidden element is hidden', async () => {
    const [gone] = (await layout('#gone')).elements;
    assert.equal(gone?.inViewport, 'hidden');
    assert.equal(gone?.hiddenReason, 'display: none');
  });

  void it('adds the iframe offset for an element inside a same-origin iframe', async () => {
    const [button] = (await layout('#frame-button')).elements;
    assert.equal(button?.context, 'iframe');
    assert.equal(button?.inViewport, 'visible');
    assert.ok((button?.bounds.x ?? 0) >= 300 + 5 + 10 + 120, JSON.stringify(button));
    assert.ok((button?.bounds.y ?? 0) >= 100 + 5 + 10, JSON.stringify(button));
  });

  void it('marks query matches outside the viewport and measures cached indices', async () => {
    const output = await bdg(['dom', 'query', 'button']);
    assert.match(output, /\[2\] <button id="save"> Save \(below fold\)$/m);
    assert.match(output, /\[0\] <button id="top"> Top$/m);
    const [save] = (await layout('2')).elements;
    assert.equal(save?.index, 2);
    assert.equal(save?.inViewport, 'below');
  });

  void it('exits 81 for --index out of range, 83 for no match and 87 for a stale index', async () => {
    await bdg(['dom', 'layout', 'button', '--index', '9'], 81);
    await bdg(['dom', 'layout', '#missing'], 83);
    await bdg(['dom', 'query', '#save']);
    await bdg(['dom', 'eval', "document.getElementById('save').remove(); 1"]);
    await bdg(['dom', 'layout', '0'], 87);
  });
});
