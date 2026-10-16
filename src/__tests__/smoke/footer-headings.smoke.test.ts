/**
 * New text after a navigation smoke test (#459).
 *
 * After a click that loads a new document, a heading or a block whose id or
 * class word (`feedback`) matches is not a message when it sits below the
 * first viewport: `New text:` stays empty on a page with a static footer. A
 * real flash after a navigation, a validation message on the same page and a
 * banner in the first viewport are still reported.
 *
 * Timing: the click waits for the navigation and reads the new document once
 * it has loaded; nothing here depends on a delay.
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
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Standard output
 */
async function bdg(args: string[]): Promise<string> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  assert.equal(result.exitCode, 0, `bdg ${args.join(' ')}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/**
 * Messages a click reported, as `--json` lists them.
 *
 * @param selector - Element to click
 * @returns Reported message texts
 */
async function clickMessages(selector: string): Promise<string[]> {
  const json = JSON.parse(await bdg(['dom', 'click', selector, '--json'])) as {
    data: { messages?: Array<{ text: string }> };
  };
  return (json.data.messages ?? []).map((message) => message.text);
}

void describe('New text after a navigation', () => {
  let fixture: FixtureServer;

  /**
   * Start a session on a fixture page.
   *
   * @param path - Page path
   */
  async function open(path: string): Promise<void> {
    await cleanupAllSessions();
    const port = await getFreePort();
    const started = await runCommand(
      `${fixture.url}${path}`,
      ['--port', String(port), '--headless'],
      {
        timeout: 60000,
      }
    );
    assert.equal(started.exitCode, 0, started.stderr);
  }

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('leaves out footer headings and feedback blocks below the first viewport', async () => {
    await open('footer-a');
    const human = await bdg(['dom', 'click', '#next']);
    assert.match(human, /navigated to .*\/footer-b/);
    assert.doesNotMatch(human, /New text/);
    assert.doesNotMatch(human, /Help improve|Tell us|Related pages/);

    await bdg(['page', 'navigate', `${fixture.url}footer-a`]);
    assert.deepEqual(await clickMessages('#next'), []);
  });

  void it('still reports a banner in the first viewport after a navigation', async () => {
    await open('footer-a');
    assert.deepEqual(await clickMessages('#cookie'), ['We use cookies']);
  });

  void it('still reports an alert role below the first viewport after a navigation', async () => {
    await open('footer-a');
    assert.deepEqual(await clickMessages('#alert'), ['Session expires soon']);
  });

  void it('still reports a validation message shown on the same page', async () => {
    await open('footer-field');
    assert.deepEqual(await clickMessages('#check'), ['Name is required']);
  });

  void it('still reports the flash of /login after /secure', async () => {
    await open('login');
    await bdg(['dom', 'fill', '#username', 'tom']);
    await bdg(['dom', 'fill', '#password', 'secret']);
    assert.deepEqual(await clickMessages('button'), ['You logged into a secure area!']);
  });
});
