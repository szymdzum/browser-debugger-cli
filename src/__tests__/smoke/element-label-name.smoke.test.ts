/**
 * Element label smoke test (#740).
 *
 * Action echoes (`dom click`) quote an element's own accessible name
 * (`aria-label`, `aria-labelledby`, `title`, image alt), also inside a
 * container with text; text borrowed from an ancestor is shown in
 * parentheses, as context rather than a name (on `/element-labels`).
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

/**
 * The element a click echoed, in human output.
 *
 * @param selector - Selector to click
 * @returns Value of the `Element:` row
 */
async function clicked(selector: string): Promise<string> {
  const output = await bdg(['dom', 'click', selector]);
  const row = /^Element: +(.*)$/m.exec(output);
  assert.ok(row, `no Element row: ${output}`);
  return (row[1] ?? '').replace(/ \(\d+ elements? match.*$/, '');
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}element-labels`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('element names in action echoes (#740)', () => {
  const cases: Array<[string, string, string]> = [
    ['aria-label inside a header with text', '.menu', 'button.menu in div.hdr "Open menu"'],
    ['aria-labelledby', '.settings', 'button.settings "Settings name"'],
    ['title only', '.print', 'button.print in div.bar "Print"'],
    ['image alt inside a button', '.download', 'button.download in div.tools "Download"'],
    ['visible text', '.save', 'button.save "Save"'],
    ['no name inside a text container', '.remember', 'input.remember in p.note ("Remember me")'],
  ];
  for (const [title, selector, expected] of cases) {
    void it(`names ${title}`, async () => {
      assert.equal(await clicked(selector), expected);
    });
  }

  void it('keeps the position for identical named siblings', async () => {
    assert.match(await clicked('.share'), /^button\.share \(1st of 2\) "Share"/);
  });

  void it('carries the same text in the --json element field', async () => {
    const json = JSON.parse(await bdg(['dom', 'click', '.menu', '--json'])) as {
      data: { element: string };
    };
    assert.equal(json.data.element, 'button.menu in div.hdr "Open menu"');
  });
});
