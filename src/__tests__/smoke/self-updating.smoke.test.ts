/**
 * Self-updating containers smoke test (#750).
 *
 * Elements a page adds by itself while an action is watched (an earlier
 * action's timer chain, a page-wide status ticker, a chat bot) are not listed
 * under `Shown:`: when their parent was already getting elements before the
 * action's first event, they are counted per container in
 * `changingOnItsOwn` (`Also changing:`). What the action's own handlers add
 * stays in `Shown:`, also into such a container, and a list that changes only
 * when clicked (Load more, also a slow one) is listed as before.
 *
 * Timing: each marked case runs right after another action on the same page,
 * so the page's own additions between the two commands are seen; the
 * streams (50 to 60 ms) and the 5 s step chain keep running through the
 * second action. The slow Load more adds its items 350 ms after the click,
 * before the second look a quiet click gets.
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

/** The part of an action result this test reads */
interface ActionData {
  shown?: Array<{ text: string; element: string }>;
  moreShown?: number;
  domChanges?: number;
  changingOnItsOwn?: Array<{ element: string; added: number }>;
}

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
 * Run a DOM action with `--json` and return its result.
 *
 * @param args - Arguments after `dom`
 * @returns Result data
 */
async function act(args: string[]): Promise<ActionData> {
  return (JSON.parse(await bdg(['dom', ...args, '--json'])) as { data: ActionData }).data;
}

/**
 * Texts of the shown elements.
 *
 * @param data - Action result
 * @returns Texts, in order
 */
function shownTexts(data: ActionData): string[] {
  return (data.shown ?? []).map((element) => element.text);
}

/**
 * Start a session on a fixture page.
 *
 * @param url - Page URL
 */
async function open(url: string): Promise<void> {
  await cleanupAllSessions();
  const port = await getFreePort();
  const started = await runCommand(url, ['--port', String(port), '--headless'], {
    timeout: 60000,
  });
  assert.equal(started.exitCode, 0, started.stderr);
}

void describe('Self-updating containers', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await cleanupAllSessions();
    await fixture.close();
  });

  void describe('a list only clicks change, and a timer chain', () => {
    before(() => open(`${fixture.url}self-updating-stream`));

    void it('lists a fast Load more as shown', async () => {
      const data = await act(['click', '#more']);
      assert.deepEqual(shownTexts(data), ['Item 1', 'Item 2', 'Item 3'], JSON.stringify(data));
      assert.equal(data.moreShown, 2, JSON.stringify(data));
      assert.equal(data.changingOnItsOwn, undefined, JSON.stringify(data));
    });

    void it('lists a slow Load more after another click as shown', async () => {
      const data = await act(['click', '#slow']);
      assert.deepEqual(shownTexts(data), ['Item 6', 'Item 7', 'Item 8'], JSON.stringify(data));
      assert.equal(data.changingOnItsOwn, undefined, JSON.stringify(data));
    });

    void it("counts an earlier click's steps under the container, not as shown", async () => {
      await act(['click', '#steps']);
      const data = await act(['click', '#note']);
      assert.deepEqual(shownTexts(data), ['Note added'], JSON.stringify(data));
      assert.equal(data.changingOnItsOwn?.[0]?.element, 'div#log', JSON.stringify(data));
      assert.ok((data.changingOnItsOwn?.[0]?.added ?? 0) > 0, JSON.stringify(data));
    });

    void it('prints the Also changing line', async () => {
      await act(['click', '#steps']);
      const output = await bdg(['dom', 'click', '#note']);
      assert.match(output, /Also changing:\s+div#log, \d+ added \(it was already changing/);
      assert.doesNotMatch(output, /Step \d+/);
    });
  });

  void describe('a page-wide status ticker', () => {
    before(() => open(`${fixture.url}self-updating-ticker`));

    void it('lists only the panels a toggle revealed', async () => {
      await act(['click', '#noop']);
      const data = await act(['click', '#toggle']);
      assert.deepEqual(
        shownTexts(data),
        ['Panel A Panel B Panel C Panel D'],
        JSON.stringify(data)
      );
      assert.equal(data.changingOnItsOwn?.[0]?.element, 'aside#ticker', JSON.stringify(data));
    });

    void it('counts only the added rows in moreShown', async () => {
      await act(['click', '#noop']);
      const data = await act(['click', '#rows']);
      assert.deepEqual(shownTexts(data), ['row 0', 'row 1', 'row 2'], JSON.stringify(data));
      assert.equal(data.moreShown, 2, JSON.stringify(data));
    });
  });

  void describe('a chat log a bot writes to', () => {
    before(() => open(`${fixture.url}self-updating-chat`));

    void it("lists the user's own message and counts the bot's", async () => {
      await act(['click', '#noop']);
      const data = await act(['click', '#send']);
      assert.deepEqual(shownTexts(data), ['Me: hello'], JSON.stringify(data));
      assert.equal(data.changingOnItsOwn?.[0]?.element, 'ul#messages', JSON.stringify(data));
    });
  });

  void describe('a page re-rendering a list on a timer', () => {
    before(() => open(`${fixture.url}silent-effects-busy`));

    void it('does not list the list under a later click, nor count it as DOM changed', async () => {
      await act(['click', '#noop']);
      const data = await act(['click', '#noop']);
      assert.equal(data.shown, undefined, JSON.stringify(data));
      assert.equal(data.domChanges, undefined, JSON.stringify(data));
      assert.equal(data.changingOnItsOwn?.[0]?.element, 'ul#list', JSON.stringify(data));
    });
  });
});
