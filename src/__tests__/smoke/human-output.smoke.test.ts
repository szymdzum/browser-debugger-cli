/**
 * Human output matches the data (#645, #585, #734): on `/human-output`,
 * `dom query` shows a same-origin link as its path and another as a full
 * URL, escapes quotes, backslashes and newlines in a value, names icon-only
 * buttons; `dom get` shows `invalid`; `dom inspect` keeps an odd id on one
 * line; an action names a button with quotes in its label escaped.
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
 * Run a bdg command and assert its exit code is 0.
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

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}human-output`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('human output matches the data', () => {
  void it('shows a same-origin link as its path and others in full', async () => {
    const output = await bdg(['dom', 'query', 'a']);
    assert.match(output, / href="\/register\/\?a=1#top"/);
    assert.match(output, / href="https:\/\/example\.com\/docs\/page"/);
    assert.match(output, / href="\/\/proto\.example\/y"/);
  });

  void it('escapes quotes, backslashes and newlines in a value, on one line', async () => {
    const output = await bdg(['dom', 'query', '#odd']);
    assert.match(output, /placeholder="say \\"hi\\" \\\\ back\\nnext"/);
  });

  void it('names icon-only buttons in dom query', async () => {
    const output = await bdg(['dom', 'query', 'button']);
    assert.match(output, /<button class="menu"> "Open menu"/);
    assert.match(output, /<button class="svgb"> "SvgTitle"/);
    assert.match(output, /<button class="quote"> "say \\"hi\\" \(now\)"/);
  });

  void it('shows invalid in dom get', async () => {
    assert.match(await bdg(['dom', 'get', '#bad']), /\binvalid\b/);
  });

  void it('keeps an odd id on one line in the dom inspect header', async () => {
    const header = (await bdg(['dom', 'inspect', 'p.odd'])).split('\n')[0] ?? '';
    assert.match(header, /^p#z\\"b\\nc/);
  });

  void it('escapes the accessible name an action echoes and counts an SVG title', async () => {
    assert.match(
      await bdg(['dom', 'click', 'button.quote']),
      /^Element: .*"say \\"hi\\" \(now\)"/m
    );
    assert.match(await bdg(['dom', 'click', 'button.svgb']), /^Element: .*"SvgTitle"/m);
  });
});
