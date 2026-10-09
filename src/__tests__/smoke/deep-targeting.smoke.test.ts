/**
 * Element targeting inside open shadow roots and same-origin iframes.
 *
 * Selectors and query indices must reach these elements for every DOM
 * command, and interactions must act on them like a user would (real mouse
 * clicks at the right place, keys to the focused field).
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as path from 'path';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';

/**
 * Run a bdg command with `--json` and return the envelope's `data`.
 *
 * @param command - bdg subcommand
 * @param args - Arguments
 * @returns Parsed `data`
 */
async function runJson<T>(command: string, args: string[]): Promise<T> {
  const result = await runCommand(command, [...args, '--json'], { timeout: 30000 });
  assert.equal(result.exitCode, 0, `bdg ${command} ${args.join(' ')}: ${result.stdout}`);
  return (JSON.parse(result.stdout) as { data: T }).data;
}

/**
 * Evaluate an expression in the page.
 *
 * @param expression - JavaScript expression
 * @returns Its value
 */
async function evaluate(expression: string): Promise<unknown> {
  return (await runJson<{ result: unknown }>('dom', ['eval', expression])).result;
}

after(removeTempDirs);

void describe('Shadow DOM and iframe targeting', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    const started = await runCommand(`${fixture.url}deep`, ['--port', String(port), '--headless'], {
      timeout: 60000,
    });
    assert.equal(started.exitCode, 0, started.stderr);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('queries the document, shadow roots and same-origin frames', async () => {
    const data = await runJson<{ nodes: Array<{ preview?: string }> }>('dom', ['query', '.note']);

    assert.deepEqual(
      data.nodes.map((node) => node.preview),
      ['light', 'shadow', 'frame']
    );
  });

  void it('fills and clicks by selector with real mouse events', async () => {
    await runJson('dom', ['fill', '#shadow-input', 'in shadow']);
    await runJson('dom', ['fill', '#frame-input', 'in frame']);
    const shadowClick = await runJson<{ method: string }>('dom', ['click', '#shadow-button']);
    const frameClick = await runJson<{ method: string }>('dom', ['click', '#frame-button']);

    assert.equal(shadowClick.method, 'mouse');
    assert.equal(frameClick.method, 'mouse');
    assert.deepEqual(
      await evaluate(
        '[document.querySelector("shadow-form").shadowRoot.getElementById("shadow-input").value, ' +
          'document.querySelector("iframe").contentDocument.getElementById("frame-input").value, ' +
          'window.events.join()]'
      ),
      ['in shadow', 'in frame', 'shadow-click,frame-click']
    );
  });

  void it('targets query indices inside frames', async () => {
    await runJson('dom', ['query', 'button']);
    await runJson('dom', ['click', '1']);
    await runJson('dom', ['pressKey', '#frame-input', 'Enter']);

    assert.match(String(await evaluate('window.events.join()')), /frame-click,frame-key:Enter$/);
  });

  void it('describes elements in frames and points to unsearchable places', async () => {
    const node = await runJson<{ node: { role?: string; name?: string } }>('dom', [
      'get',
      '#frame-input',
    ]);
    assert.equal(node.node.role, 'textbox');
    assert.equal(node.node.name, 'Frame field');

    const emptyQuery = await runCommand('dom', ['query', '#missing']);
    assert.equal(emptyQuery.exitCode, 83);
    assert.doesNotMatch(emptyQuery.stderr, /cross-origin/, 'the page has no cross-origin iframe');
    const typo = await runCommand('dom', ['query', '.notes']);
    assert.equal(typo.exitCode, 83);
    assert.match(typo.stderr, /Did you mean \.note\? \(similar class on the page\)/);
    const staleIndex = await runCommand('dom', ['get', '0']);
    assert.notEqual(staleIndex.exitCode, 0, 'an empty query must not leave older indices usable');
    const missing = await runCommand('dom', ['get', '#missing', '--raw', '--json']);
    const envelope = JSON.parse(missing.stdout) as { suggestion?: string };
    assert.match(envelope.suggestion ?? '', /Verify the CSS selector is correct/);
    assert.doesNotMatch(envelope.suggestion ?? '', /cross-origin/);
  });

  void it('describes and captures elements in shadow roots and frames', async () => {
    const button = await runJson<{ node: { role?: string; name?: string } }>('dom', [
      'a11y',
      'describe',
      '#shadow-button',
    ]);
    assert.equal(button.node.name, 'Shadow');

    const file = path.join(makeTempDir('bdg-deep-'), 'button.png');
    await runJson('dom', ['screenshot', file, '--selector', '#frame-button']);
    const png = fs.readFileSync(file);
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.ok(width < 120 && height < 60, `captured ${width}x${height}, not just the button`);
  });

  void it('lists event listeners of elements in shadow roots and frames', async () => {
    type Listed = { frame?: string; listeners: Array<{ type: string; on: string }> };
    for (const [selector, frame] of [['#shadow-button'], ['#frame-button', 'iframe']]) {
      const listed = await runJson<Listed>('dom', ['listeners', selector ?? '', '--type', 'click']);
      assert.deepEqual(
        listed.listeners.map((l) => `${l.type}:${l.on}`),
        ['click:target'],
        selector
      );
      assert.equal(listed.frame, frame, selector);
    }
  });

  void it('reads the accessibility tree of same-origin frames', async () => {
    const result = await runCommand('dom', ['a11y', 'query', 'role:button name:Frame', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const found = JSON.parse(result.stdout) as { data: { count: number } };
    assert.equal(found.data.count, 1);
  });

  void it('lists shadow root fields and still names the frame holding form fields', async () => {
    const result = await runCommand('dom', ['form', '--all', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    const data = (
      JSON.parse(result.stdout) as {
        data: { forms: Array<{ fields: Array<{ selector: string }> }>; formsInFrames?: string[] };
      }
    ).data;
    assert.ok(
      data.forms.some((form) => form.fields.some((field) => field.selector === '#shadow-input')),
      result.stdout
    );
    assert.match(String(data.formsInFrames), /\/deep-frame$/);
    const human = await runCommand('dom', ['form', '--all']);
    assert.match(
      human.stdout,
      /Note: an iframe holds form fields dom form does not list: \S+\/deep-frame/
    );
  });

  void it('points to fields of a form inside a same-origin frame (89)', async () => {
    const removed = await runCommand('dom', [
      'eval',
      "document.querySelector('shadow-form').remove(); 1",
    ]);
    assert.equal(removed.exitCode, 0, removed.stderr);
    const result = await runCommand('dom', ['form', '--json']);
    assert.equal(result.exitCode, 89);
    assert.match(result.stdout, /deep-frame/);
  });

  void it('reports an invalid selector as a user error', async () => {
    const result = await runCommand('dom', ['query', 'input[', '--json']);

    assert.equal(result.exitCode, 81);
    assert.match(result.stdout, /Invalid CSS selector/);
  });
});
