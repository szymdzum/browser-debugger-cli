/**
 * Long values smoke test (#440).
 *
 * A page that logs a 500 KB string, throws a 100 KB Error and holds a 3 MB
 * DOM: `peek` and the `console` summary print no message longer than
 * `console --list` does, `dom get --raw` and `dom eval` print a cut value with
 * a pointer naming `--full`, JSON values over the cap carry `truncatedFrom`,
 * and `--full` gives every value back byte for byte.
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
import { MAX_CONSOLE_JSON_TEXT_LENGTH, MAX_VALUE_LENGTH } from '@/constants.js';

const LOGGED_LENGTH = 500_000;
const THROWN_LENGTH = 100_000;
const DOM_LENGTH = 3_000_000;

const SETUP_SCRIPT = `document.body.insertAdjacentHTML('beforeend', '<div id="big">' + 'D'.repeat(${DOM_LENGTH}) + '</div>');
console.log('L'.repeat(${LOGGED_LENGTH}));
setTimeout(() => { throw new Error('E'.repeat(${THROWN_LENGTH})); });
1`;

const POINTER = /more chars \(use --full\)/;

interface ConsoleData {
  errors: Array<{ text: string; truncatedFrom?: number }>;
  messages?: Array<{ text: string; truncatedFrom?: number }>;
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Its stdout
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/**
 * Run a bdg command with `--json` and return the envelope's data.
 *
 * @param args - bdg arguments without `--json`
 * @returns The data
 */
async function bdgJson<T>(args: string[]): Promise<T> {
  return (JSON.parse(await bdg([...args, '--json'])) as { data: T }).data;
}

/**
 * Longest line of a text.
 *
 * @param text - Output
 * @returns Its length
 */
function longestLine(text: string): number {
  return Math.max(...text.split('\n').map((line) => line.length));
}

/**
 * Wait until the session has recorded the error the setup script throws from
 * a timer, after its eval returned (the tests read it from the console).
 */
async function waitForThrownError(): Promise<void> {
  const deadline = Date.now() + 20000;
  for (;;) {
    const data = await bdgJson<ConsoleData>(['console', '--list']);
    if (data.errors.some((error) => error.text.includes('EEE'))) return;
    assert.ok(Date.now() < deadline, 'the thrown error was never recorded');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

void describe('Long values', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    await bdg([`${fixture.url}interactions`, '--port', String(await getFreePort()), '--headless']);
    await bdg(['dom', 'eval', SETUP_SCRIPT]);
    await waitForThrownError();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('peek and the console summary print no message longer than console --list', async () => {
    const listed = await bdg(['console', '--list']);
    assert.match(listed, POINTER);
    const limit = longestLine(listed);
    for (const args of [['peek'], ['peek', '--verbose'], ['console']]) {
      const output = await bdg(args);
      assert.ok(longestLine(output) <= limit, `bdg ${args.join(' ')}: ${output.length} chars`);
      assert.ok(output.length < 5000, `bdg ${args.join(' ')}: ${output.length} chars`);
    }
  });

  void it('dom get --raw and dom eval print the cap and a pointer naming --full', async () => {
    for (const args of [
      ['dom', 'get', 'body', '--raw'],
      ['dom', 'eval', 'document.documentElement.outerHTML'],
    ]) {
      const output = await bdg(args);
      assert.ok(output.length < MAX_VALUE_LENGTH + 100, `${args.join(' ')}: ${output.length}`);
      assert.match(output, POINTER);
    }
  });

  void it('JSON console messages and eval strings over the cap carry truncatedFrom', async () => {
    const data = await bdgJson<ConsoleData>(['console', '--list']);
    const logged = data.messages?.find((message) => message.text.startsWith('LLL'));
    assert.equal(logged?.text.length, MAX_CONSOLE_JSON_TEXT_LENGTH);
    assert.equal(logged?.truncatedFrom, LOGGED_LENGTH);
    const thrown = data.errors.find((error) => error.text.includes('EEE'));
    assert.ok((thrown?.truncatedFrom ?? 0) > THROWN_LENGTH, 'error has truncatedFrom');
    const peeked = await bdgJson<{ console: ConsoleData['errors'] }>(['peek']);
    assert.ok(
      peeked.console.every((message) => message.text.length <= MAX_CONSOLE_JSON_TEXT_LENGTH)
    );

    const evaluated = await bdgJson<{ result: string; truncatedFrom?: number }>([
      'dom',
      'eval',
      'document.body.outerHTML',
    ]);
    assert.equal(evaluated.result.length, MAX_VALUE_LENGTH);
    assert.ok((evaluated.truncatedFrom ?? 0) > DOM_LENGTH);
  });

  void it('--full returns the full values byte for byte', async () => {
    const html = (
      await bdgJson<{ result: string }>(['dom', 'eval', 'document.body.outerHTML', '--full'])
    ).result;
    assert.ok(html.length > DOM_LENGTH);
    assert.equal(await bdg(['dom', 'get', 'body', '--raw', '--full']), `${html}\n`);
    assert.equal(await bdg(['dom', 'eval', 'document.body.outerHTML', '--full']), `${html}\n`);

    const data = await bdgJson<ConsoleData>(['console', '--list', '--full']);
    assert.ok(data.messages?.some((message) => message.text === 'L'.repeat(LOGGED_LENGTH)));
    assert.ok(data.messages?.every((message) => message.truncatedFrom === undefined));
    assert.ok((await bdg(['peek', '--full'])).includes('L'.repeat(LOGGED_LENGTH)));
    assert.ok((await bdg(['console', '--full'])).includes('E'.repeat(THROWN_LENGTH)));
  });
});
