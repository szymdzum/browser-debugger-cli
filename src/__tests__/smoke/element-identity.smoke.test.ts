/**
 * Element identity smoke test (#614).
 *
 * `dom a11y describe` shows relation properties (`labelledby`, …) by the
 * ids of the related elements, in human output and `--json`, and never
 * prints `undefined` (on `/shadow-forms`, a field with `aria-labelledby`).
 * Action echoes (`dom press-key`, `dom fill`, `dom click`, `dom hover`) name
 * a field by its label or unique `name` (`input[name=email]`), without a
 * position among its siblings that reads like a match count next to
 * "3 elements match" (on `/implicit-submit`, the sign-up form of the
 * issue, and a labelled field in a shadow root); a password field is named
 * by its name, never its value.
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

/** What the tests read of `dom a11y describe --json` */
interface DescribeJson {
  node: { name?: string; properties?: Record<string, unknown> };
}

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
 * The `Element:` row of an action's human output.
 *
 * @param output - Human output
 * @returns The row's value
 */
function elementRow(output: string): string {
  const row = /^Element: +(.*)$/m.exec(output);
  assert.ok(row, `no Element row: ${output}`);
  return row[1] ?? '';
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}shadow-forms`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom a11y describe relation properties', () => {
  void it('shows labelledby by the related id and never prints undefined (#614)', async () => {
    await bdg(['page', 'navigate', `${fixture.url}shadow-forms`]);
    await bdg(['dom', 'query', 'input']);
    const human = await bdg(['dom', 'a11y', 'describe', '3']);
    assert.doesNotMatch(human, /undefined/);
    assert.match(human, /^labelledby: +#nl-label$/m);
    const json = JSON.parse(await bdg(['dom', 'a11y', 'describe', '3', '--json'])) as {
      data: DescribeJson;
    };
    assert.equal(json.data.node.name, 'Newsletter email');
    assert.equal(json.data.node.properties?.['labelledby'], 'nl-label');
  });

  void it('names a labelled field by its label, not by its ancestor text (#614, #631)', async () => {
    await bdg(['page', 'navigate', `${fixture.url}shadow-forms`]);
    await bdg(['dom', 'query', 'input']);
    assert.equal(
      elementRow(await bdg(['dom', 'fill', '3', 'x'])).replace(/ \(index 3 .*\)$/, ''),
      'input[name=nl-email] "Newsletter email"'
    );
  });
});

void describe('action echoes on the sign-up form (#614)', () => {
  before(async () => {
    await bdg(['page', 'navigate', `${fixture.url}implicit-submit`]);
  });

  void it('names the field pressKey hit by its name, without a sibling position', async () => {
    const output = await bdg(['dom', 'press-key', '#signup input', 'Enter']);
    assert.match(output, /3 elements match/);
    assert.equal(elementRow(output), 'input[name=email]');
    assert.doesNotMatch(output, /\(\d+(st|nd|rd|th) of \d+\)/);
  });

  void it('names fields by name in fill, hover and click echoes', async () => {
    assert.equal(
      elementRow(await bdg(['dom', 'fill', '#signup input', 'ada@example.com'])),
      'input[name=email]'
    );
    assert.equal(
      elementRow(await bdg(['dom', 'hover', '#duo input', '--index', '1'])),
      'input[name=last]'
    );
    assert.equal(
      elementRow(await bdg(['dom', 'click', '#signup [name=terms]'])),
      'input[name=terms] "I agree"'
    );
  });

  void it('keeps the position for siblings sharing a name and a label', async () => {
    await bdg([
      'eval',
      `document.body.insertAdjacentHTML('beforeend', '<div id="twins"><span id="twin-label">Twin</span>' +
        '<input name="twin" aria-labelledby="twin-label"><input name="twin" aria-labelledby="twin-label"></div>'); 1`,
    ]);
    try {
      const output = await bdg(['dom', 'hover', '#twins input']);
      assert.match(output, /2 elements match/);
      assert.equal(elementRow(output), 'input[name=twin] (1st of 2) "Twin"');
      assert.equal(
        elementRow(await bdg(['dom', 'hover', '#twins input', '--index', '1'])),
        'input[name=twin] (2nd of 2) "Twin"'
      );
    } finally {
      await bdg(['eval', "document.getElementById('twins').remove(); 1"]);
    }
  });

  void it('names a button with text by its aria-labelledby', async () => {
    await bdg([
      'eval',
      `document.body.insertAdjacentHTML('beforeend', '<div id="hl-box"><span id="hl">Hover me</span>' +
        '<button id="hl-btn" aria-labelledby="hl">btn</button></div>'); 1`,
    ]);
    try {
      assert.equal(
        elementRow(await bdg(['dom', 'hover', '#hl-box button'])),
        'button#hl-btn "Hover me"'
      );
    } finally {
      await bdg(['eval', "document.getElementById('hl-box').remove(); 1"]);
    }
  });

  void it('names a password field by its name, never its value', async () => {
    await bdg(['dom', 'fill', '#signup [name=password]', 'hunter2-614']);
    const output = await bdg(['dom', 'press-key', '#signup [name=password]', 'a']);
    assert.equal(elementRow(output), 'input[name=password]');
    assert.doesNotMatch(output, /hunter2-614/);
  });
});
