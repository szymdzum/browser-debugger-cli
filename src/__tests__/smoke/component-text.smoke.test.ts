/**
 * Smoke tests for text web components render themselves, against a real
 * Chrome and the `/components` fixture page: `dom get`, `dom query` and
 * `dom layout` read a component through its shadow root (fallback content,
 * internal labels, slotted content in place, blocks set apart), text filters
 * and `dom wait --text` match the text they show, `dom layout` and
 * `dom click` see clipping through a slot, and action results name the
 * element a user sees.
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

void describe('Text web components render themselves', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}components`, '--port', String(port), '--headless']);
    await bdg(['dom', 'wait', '--load']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reads slots, fallback content and shadow-only text, blocks set apart', async () => {
    const output = await bdg([
      'dom',
      'query',
      '#filled, #empty, #hidden-title, #shadow-only, #field, #dialog',
    ]);
    assert.match(output, /<x-card id="filled"> Named Title Default body Card action\n/);
    assert.match(output, /<x-card id="empty"> Fallback title Fallback body Card action\n/);
    assert.match(output, /<x-card id="hidden-title"> Shown Title Body Card action\n/);
    assert.match(output, /<x-shadow-only id="shadow-only"> Shadow only text\n/);
    assert.match(output, /<x-field id="field"> What is your name\?\n/);
    assert.match(output, /<x-dialog id="dialog"> Dialog title Dialog body\n/);
    assert.doesNotMatch(output, /Hidden Title|Light text never shown/);
  });

  void it('names a host by its visible text in the shadow root label', async () => {
    const output = await bdg(['dom', 'query', 'button']);
    assert.match(
      output,
      /<button> \(in shadow root of <x-card#hidden-title "Shown Title Body Card action">\) Card action/
    );
    assert.match(
      output,
      /<button class="root"> \(in shadow root of <x-button#ok "Ok, got it">\) Ok, got it/
    );
    assert.match(output, /<x-card#filled "Named Title Default body Card …">/);
  });

  void it('lists what the shadow root of a component without text holds', async () => {
    assert.match(
      await bdg(['dom', 'get', '#close']),
      /^No text; its shadow root holds 1 element: button#icon "Close" \(see it with bdg dom inspect\)$/m
    );
  });

  void it('shows the open shadow root children in dom inspect, where dom get points', async () => {
    assert.match(await bdg(['dom', 'inspect', '#close']), /^ {2}button#icon \S+ \(shadow root\)/m);
  });

  void it('measures an open display: contents dialog host by what it shows', async () => {
    const output = await bdg(['dom', 'layout', '#dialog']);
    assert.match(output, /x-dialog#dialog "Dialog title Dialog body" +\d+,\d+ 240×100 +visible/);
  });

  void it('places a slot by the content it shows, in dom query, --json, layout and inspect', async () => {
    const output = await bdg(['dom', 'query', 'slot']);
    assert.match(
      output,
      /\[7\] <slot> \(in shadow root of <x-button#ok "Ok, got it">\) Ok, got it\n/
    );
    assert.match(output, /\[0\] <slot name="title">.* Named Title\n/);
    assert.match(output, /\[2\] <slot name="title">.* Fallback title\n/);
    assert.match(output, /\[9\] <slot>.* Hidden \(hidden\)\n/);
    const json = JSON.parse(await bdg(['dom', 'query', 'slot', '--json'])) as {
      data: { nodes: { inViewport?: string }[] };
    };
    assert.deepEqual(
      json.data.nodes.map((node) => node.inViewport),
      [...Array<string>(9).fill('visible'), 'hidden']
    );
    assert.match(
      await bdg(['dom', 'layout', 'slot', '--index', '7']),
      /\[7\] slot "Ok, got it" +\d+,\d+ +\d+×\d+ +visible/
    );
    assert.doesNotMatch(await bdg(['dom', 'inspect', 'slot', '--index', '7']), /not rendered/);
  });

  void it('says a click on a slot found no box to aim at, not display: none', async () => {
    const output = await bdg(['dom', 'click', 'slot', '--index', '7']);
    assert.match(
      output,
      /Element is not a mouse target itself \(display: contents, no box of its own\)/
    );
    assert.doesNotMatch(output, /display: none/);
  });

  void it('names the element an action hit by what a user sees', async () => {
    const shadowButton = await bdg(['dom', 'click', 'button.root']);
    assert.match(shadowButton, /Element: +button\.root "Ok, got it"/);
    assert.match(shadowButton, /Method: +mouse events/);
    assert.match(await bdg(['dom', 'click', '#logo']), /Element: +a#logo "Company logo"/);
    assert.match(await bdg(['dom', 'fill', '#user', 'bob']), /Element: +input#user "User"/);
    assert.match(
      await bdg(['dom', 'fill', 'input#input', 'Ada']),
      /Element: +input#input "What is your name\?"/
    );
  });

  void it('matches text filters against the text a component shows', async () => {
    assert.match(await bdg(['dom', 'query', 'x-btn']), /<x-btn id="draft"> Save draft\n/);
    assert.match(
      await bdg(['dom', 'query', 'x-btn:has-text("Save")']),
      /<x-btn id="draft"> Save draft\n/
    );
    assert.match(
      await bdg(['dom', 'query', 'x-btn:text-is("Save draft")']),
      /<x-btn id="draft"> Save draft\n/
    );
    await bdg(['dom', 'wait', 'x-btn', '--text', 'Save draft', '--timeout', '3000']);
  });

  void it('measures an element slotted into a collapsed container as clipped', async () => {
    assert.match(
      await bdg(['dom', 'layout', '#light-hidden']),
      /button#light-hidden "Hidden" +hidden \(clipped by div#light-acc: zero height\)/
    );
    assert.match(
      await bdg(['dom', 'layout', '#slotted-hidden']),
      /button#slotted-hidden "Hidden" +hidden \(clipped by div: zero height\)/
    );
  });

  void it('says a click hit an element clipped away, through a slot or not', async () => {
    assert.match(
      await bdg(['dom', 'click', '#light-hidden']),
      /Element is hidden \(clipped by div#light-acc: zero height\)/
    );
    const slotted = await bdg(['dom', 'click', '#slotted-hidden']);
    assert.match(slotted, /Element is hidden \(clipped by div: zero height\)/);
    assert.doesNotMatch(slotted, /covered by another element/);
  });
});
