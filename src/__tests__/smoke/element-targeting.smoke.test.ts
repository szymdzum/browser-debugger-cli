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
