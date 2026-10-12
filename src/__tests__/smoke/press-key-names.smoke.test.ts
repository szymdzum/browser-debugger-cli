/**
 * `dom pressKey` key names smoke test (#612).
 *
 * On `/key-log` the page records the `keydown` events it gets. Punctuation,
 * a shifted symbol, a capital, a modifier key, `NumpadEnter` and a DOM code
 * name (`Period`) reach it with the key, code and shiftKey Chrome gives a
 * physical key on a US layout; short unknown input exits 81 without the
 * misleading F1-F3 suggestion, and the empty name says a key name is
 * required. Each result is read from the page's record after the command,
 * never after a delay.
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
 * The keydown events the page recorded.
 *
 * @returns Entries as `key|code|shiftKey`
 */
async function keyLog(): Promise<string[]> {
  const output = await bdg(['dom', 'eval', 'window.keyLog', '--json']);
  return (JSON.parse(output) as { data: { result: string[] } }).data.result;
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  await bdg([`${fixture.url}key-log`, '--port', String(port), '--headless']);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom pressKey key names (#612)', () => {
  void it('dispatches punctuation, shifted symbols, modifiers and code names like Chrome', async () => {
    const pressed: Array<[string, string]> = [
      ['.', '.|Period|false'],
      ['_', '_|Minus|true'],
      ['A', 'A|KeyA|true'],
      ['Shift', 'Shift|ShiftLeft|true'],
      ['NumpadEnter', 'Enter|NumpadEnter|false'],
      ['Period', '.|Period|false'],
    ];
    for (const [name] of pressed) await bdg(['dom', 'pressKey', '#field', name]);
    assert.deepEqual(
      await keyLog(),
      pressed.map(([, entry]) => entry)
    );
  });

  void it('types a punctuation character into the field', async () => {
    await bdg(['dom', 'eval', "document.getElementById('field').value = ''"]);
    await bdg(['dom', 'pressKey', '#field', '/']);
    const output = await bdg(['dom', 'eval', "document.getElementById('field').value"]);
    assert.match(output, /\//);
  });

  void it('rejects short unknown input without a function key suggestion', async () => {
    const output = await bdg(['dom', 'pressKey', '#field', 'Foo'], 81);
    assert.doesNotMatch(output, /F1, F2|Did you mean/);
    assert.match(output, /Keys: .*F1-F12/);
  });

  void it('asks for a key name when it is empty', async () => {
    const output = await bdg(['dom', 'pressKey', '#field', ''], 81);
    assert.match(output, /key name required/i);
  });
});
