/**
 * `dom get` context smoke test (#586).
 *
 * `domContext.id` is reported when the element has an id, and the human
 * context line shows it as `tag#id`. Void elements and form controls get no
 * "No text and no child elements" line; a hollow non-void element still does.
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

const EMPTY_LINE = /No text and no child elements/;

/**
 * Run a bdg command and assert its exit code.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Stdout
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * The `domContext` of `dom get --json` for a selector.
 *
 * @param selector - CSS selector
 * @returns The context object
 */
async function contextOf(selector: string): Promise<Record<string, unknown>> {
  const out = await bdg(['dom', 'get', selector, '--json']);
  const envelope = JSON.parse(out) as { data: { domContext?: Record<string, unknown> } };
  assert.ok(envelope.data.domContext, `domContext of ${selector}`);
  return envelope.data.domContext;
}

void describe('dom get context', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}dom-get-context`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('reports the id in domContext and the human line (#586)', async () => {
    assert.equal((await contextOf('#x'))['id'], 'x');
    assert.match(await bdg(['dom', 'get', '#x']), /\[Paragraph\] <p#x> "Hello para"/);
  });

  void it('omits id from domContext when the element has none', async () => {
    const context = await contextOf('.anon');
    assert.equal('id' in context, false);
    assert.match(await bdg(['dom', 'get', '.anon']), /<p\.anon>/);
  });

  void it('prints no empty-element line for void elements and form controls (#586)', async () => {
    for (const selector of ['#q', '#agree', '#pick', '#notes', '#pic', '#rule']) {
      assert.doesNotMatch(await bdg(['dom', 'get', selector]), EMPTY_LINE, selector);
    }
  });

  void it('keeps the id on a form control line', async () => {
    assert.match(await bdg(['dom', 'get', '#q']), /<input#q>/);
  });

  void it('still says a hollow div has no text and no child elements', async () => {
    assert.match(await bdg(['dom', 'get', '#hollow']), EMPTY_LINE);
    assert.match(await bdg(['dom', 'get', '.bare']), EMPTY_LINE);
  });
});
