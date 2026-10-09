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
 * closing the only tab (81). A window that logged an error while it loaded
 * has that error listed after the first switch to it, and `network list`
 * notes the switch. A window that closes itself on a timer while the
 * session is on it: the next command reports the move, and the first action
 * after it is refused once (90) instead of running on the opener.
 *
 * Timing: Chrome reports a new target, its URL and a closing tab within a
 * few tens of ms; each click waits for its effects (at least 150 ms of
 * quiet) before it reads them, so what it reports was seen by then. The
 * click on the popup's button waits for the session's switch itself. The
 * loader window posts to its opener once it logged and fetched, which the
 * test waits for before switching; after arming a window's close timer,
 * the test waits until `bdg status` (which does not take the move notice)
 * shows the session on the opener.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import type { OpenedTab, PageTabsData, TabRef, TabSwitchInfo } from '@/ipc/protocol/tabTypes.js';
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

/** Envelope of a `--json` answer, success or error */
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode?: number;
  tabClosed?: TabRef;
  switchedTo?: TabRef;
}

/**
 * Run a bdg command with --json and return its envelope, whatever the exit code.
 *
 * @param args - Full bdg argument list, without --json
 * @returns Envelope and exit code
 */
async function bdgEnvelope<T>(args: string[]): Promise<Envelope<T> & { code: number }> {
  const [command = '', ...rest] = args;
  const result = await runCommand(command, [...rest, '--json'], { timeout: 60000 });
  return { ...(JSON.parse(result.stdout) as Envelope<T>), code: result.exitCode };
}

/**
 * Poll until a condition holds.
 *
 * @param what - What is waited for (for the failure)
 * @param check - The condition
 */
async function waitUntil(what: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

/**
 * Wait until `bdg status` shows the session on a URL (status does not take
 * the notice of a move).
 *
 * @param url - The URL
 */
async function waitForSessionOn(url: string): Promise<void> {
  await waitUntil(`the session on ${url}`, async () => {
    const status = await bdgEnvelope<{ pageState?: { url: string } }>(['status']);
    return status.data?.pageState?.url === url;
  });
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
      tabs.map((tab) => [tab.index, tab.url, tab.current, tab.openedBy, tab.kind]),
      [
        [0, `${fixture.url}tabs`, true, undefined, 'tab'],
        [1, `${fixture.url}tabs-popup`, undefined, 0, 'popup'],
        [2, `${fixture.url}tabs-tab`, undefined, undefined, 'tab'],
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

    const unknown = await run(['page', 'close', 'nosuch']);
    assert.equal(unknown.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND, unknown.output);
    assert.match(unknown.output, /bdg page close <index>/);
    assert.doesNotMatch(unknown.output, /page switch/);
    assert.match(await bdg(['page', 'close', '--help']), /url:/);
  });

  void it('lists what a window logged while loading after the first switch, and notes the switch', async () => {
    await bdg(['dom', 'click', '#open-loader']);
    await waitUntil('the loader to log and fetch', async () => {
      const token = await bdgJson<{ result: unknown }>([
        'dom',
        'eval',
        "document.getElementById('token').textContent",
      ]);
      return token.result === 'loader-ready';
    });
    await bdg(['page', 'switch', 'tabs-loader']);

    const consoleOutput = await bdg(['console', '--list']);
    assert.match(consoleOutput, /loader failed while loading/);

    const network = await bdgJson<{ tabSwitch?: TabSwitchInfo }>(['network', 'list']);
    assert.equal(network.tabSwitch?.tab.url, `${fixture.url}tabs-loader`, JSON.stringify(network));
    assert.equal(network.tabSwitch?.tab.index, 1);
    assert.match(
      await bdg(['network', 'list']),
      /Switched to tab 1 at .*; its earlier requests are not recorded/
    );
    assert.match(await bdg(['peek']), /Switched to tab 1 at /);

    await bdg(['page', 'close']);
  });

  void it('refuses the first action after a window closed itself, naming the move (90)', async () => {
    await bdg(['dom', 'click', '#open-selfclose']);
    await bdg(['page', 'switch', 'tabs-selfclose']);
    await bdg(['dom', 'eval', 'setTimeout(() => window.close(), 50); 1']);
    await waitForSessionOn(`${fixture.url}tabs`);

    const refused = await bdgEnvelope(['dom', 'click', '#token']);
    assert.equal(refused.code, EXIT_CODES.RESOURCE_CONFLICT, JSON.stringify(refused));
    assert.match(refused.error ?? '', /Tab closed: .*tabs-selfclose; now on tab 0: .*\/tabs\b/);
    assert.match(refused.error ?? '', /not run/);
    assert.equal(refused.tabClosed?.url, `${fixture.url}tabs-selfclose`);
    assert.equal(refused.switchedTo?.index, 0);

    const again = await bdgEnvelope<ClickTabs>(['dom', 'click', '#token']);
    assert.equal(again.code, 0, JSON.stringify(again));
    assert.equal(again.tabClosed, undefined);
    assert.equal(again.data?.tabClosed, undefined);
  });

  void it('reports such a move on the next read-only command, which still runs', async () => {
    await bdg(['dom', 'click', '#open-selfclose']);
    await bdg(['page', 'switch', 'tabs-selfclose']);
    await bdg(['dom', 'eval', 'setTimeout(() => window.close(), 50); 1']);
    await waitForSessionOn(`${fixture.url}tabs`);

    const missing = await run(['dom', 'query', '#selfclose']);
    assert.equal(missing.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND, missing.output);
    assert.match(missing.output, /Tab closed: .*tabs-selfclose; now on tab 0: /);

    const info = await bdgEnvelope<{ url: string }>(['page', 'info']);
    assert.equal(info.code, 0);
    assert.equal(info.tabClosed, undefined, 'reported once');

    const refused = await run(['dom', 'click', '#token']);
    assert.equal(refused.exitCode, EXIT_CODES.RESOURCE_CONFLICT, refused.output);
    assert.match(refused.output, /Tab closed: .*tabs-selfclose/);
    assert.equal((await run(['dom', 'click', '#token'])).exitCode, 0);
  });
});
