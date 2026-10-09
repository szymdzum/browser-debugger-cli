/**
 * Tabs smoke test.
 *
 * On the `/tabs` fixture: a `window.open()` click and a `target=_blank` click
 * list the page they opened (JSON and human output); `page tabs` lists both;
 * after `page switch`, `page info`, `dom query` and `dom click` act on the
 * popup; the popup's button posts a token to its opener and calls
 * `window.close()`, and the click reports that the session went back to the
 * opener, where the token arrived; `page switch` and `page close` refuse
 * unknown URL parts (83, with the tabs), indices out of range (81) and
 * closing the only tab (81).
 *
 * Timing: Chrome reports a new target, its URL and a closing tab within a
 * few tens of ms; each click waits for its effects (at least 150 ms of
 * quiet) before it reads them, so what it reports was seen by then. The
 * click on the popup's button waits for the session's switch itself.
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
import type { OpenedTab, PageTabsData, TabRef } from '@/ipc/protocol/tabTypes.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Result of a bdg command */
interface BdgRun {
  output: string;
  exitCode: number;
}

/**
 * Run a bdg command.
 *
 * @param args - Full bdg argument list (first element is the subcommand)
 * @returns Combined stdout and stderr, and the exit code
 */
async function run(args: string[]): Promise<BdgRun> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, rest, { timeout: 60000 });
  return { output: `${result.stdout}${result.stderr}`, exitCode: result.exitCode };
}

/**
 * Run a bdg command and assert it succeeded.
 *
 * @param args - Full bdg argument list
 * @returns Combined stdout and stderr
 */
async function bdg(args: string[]): Promise<string> {
  const { output, exitCode } = await run(args);
  assert.equal(exitCode, 0, `bdg ${args.join(' ')}: ${output}`);
  return output;
}

/**
 * Run a bdg command with --json and return its data.
 *
 * @param args - Full bdg argument list, without --json
 * @returns The `data` of the answer
 */
async function bdgJson<T>(args: string[]): Promise<T> {
  return (JSON.parse(await bdg([...args, '--json'])) as { data: T }).data;
}

/** What a click reports about tabs */
interface ClickTabs {
  opened?: OpenedTab[];
  tabClosed?: TabRef;
  switchedTo?: TabRef;
}

void describe('Tabs', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
    const port = await getFreePort();
    await bdg([`${fixture.url}tabs`, '--port', String(port), '--headless']);
  });

  after(async () => {
    await run(['stop']);
    await cleanupAllSessions();
    await fixture.close();
  });

  void it('lists the popup a window.open() click opened', async () => {
    const click = await bdgJson<ClickTabs>(['dom', 'click', '#open-popup']);

    assert.equal(click.opened?.length, 1, JSON.stringify(click));
    assert.equal(click.opened[0]?.kind, 'popup');
    assert.equal(click.opened[0]?.url, `${fixture.url}tabs-popup`);
    assert.equal(click.opened[0]?.index, 1);
    assert.match(click.opened[0]?.targetId ?? '', /^[0-9A-F]{32}$/);
  });

  void it('lists the tab a target=_blank click opened, with the switch command', async () => {
    const output = await bdg(['dom', 'click', '#open-tab']);

    assert.match(output, new RegExp(`Opened: tab ${fixture.url}tabs-tab \\(bdg page switch 2\\)`));
  });

  void it('page tabs lists the opener and both pages it opened', async () => {
    const { tabs } = await bdgJson<PageTabsData>(['page', 'tabs']);

    assert.deepEqual(
      tabs.map((tab) => [tab.index, tab.url, tab.current, tab.openedBy]),
      [
        [0, `${fixture.url}tabs`, true, undefined],
        [1, `${fixture.url}tabs-popup`, undefined, 0],
        [2, `${fixture.url}tabs-tab`, undefined, 0],
      ]
    );
    assert.match(await bdg(['page', 'tabs']), /\* \[0\] Opener/);
  });

  void it('refuses an unknown URL part (83) with the tabs and an index out of range (81)', async () => {
    const typo = await run(['page', 'switch', 'tabs-tabb']);
    assert.equal(typo.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND, typo.output);
    assert.match(typo.output, /No tab URL contains "tabs-tabb"/);
    assert.match(typo.output, /Did you mean: bdg page switch tabs-tab\?/);
    assert.match(typo.output, /\[1\] .*tabs-popup/);

    const outOfRange = await run(['page', 'switch', '9']);
    assert.equal(outOfRange.exitCode, EXIT_CODES.INVALID_ARGUMENTS, outOfRange.output);
    assert.match(outOfRange.output, /Tab index 9 out of range \(3 tabs: 0-2\)/);
  });

  void it('after page switch 1, page info, dom query and dom click act on the popup', async () => {
    const switched = await bdg(['page', 'switch', '1']);
    assert.match(switched, /Switched to tab 1/);

    const info = await bdgJson<{ url: string }>(['page', 'info']);
    assert.equal(info.url, `${fixture.url}tabs-popup`);
    assert.match(await bdg(['dom', 'query', '#allow']), /Found 1 node/);

    const click = await bdgJson<ClickTabs>(['dom', 'click', '#allow']);
    assert.equal(click.tabClosed?.url, `${fixture.url}tabs-popup`, JSON.stringify(click));
    assert.equal(click.switchedTo?.url, `${fixture.url}tabs`);
    assert.equal(click.switchedTo?.index, 0);
  });

  void it('is back on the opener after the popup closed itself', async () => {
    const info = await bdgJson<{ url: string }>(['page', 'info']);
    assert.equal(info.url, `${fixture.url}tabs`);

    const token = await bdgJson<{ result: unknown }>([
      'dom',
      'eval',
      "document.getElementById('token').textContent",
    ]);
    assert.equal(token.result, 'token-123');
    const { tabs } = await bdgJson<PageTabsData>(['page', 'tabs']);
    assert.deepEqual(
      tabs.map((tab) => tab.url),
      [`${fixture.url}tabs`, `${fixture.url}tabs-tab`]
    );
  });

  void it('page close closes another tab, and refuses the only tab (81)', async () => {
    const closed = await bdgJson<{ closed: TabRef }>(['page', 'close', 'tabs-tab']);
    assert.equal(closed.closed.url, `${fixture.url}tabs-tab`);

    const only = await run(['page', 'close']);
    assert.equal(only.exitCode, EXIT_CODES.INVALID_ARGUMENTS, only.output);
    assert.match(only.output, /only tab/);
  });
});
