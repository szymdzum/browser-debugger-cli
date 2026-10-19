/**
 * Load-failure matrix (#862): every command that navigates or waits on a load
 * x every way a load can fail, judged by one oracle (`loadFailureCells.ts`):
 * a failed load never says ✓, "Session Started", "Navigated" or "No errors",
 * exits with a code from `exitCodes.ts` and names the cause (the `net::` code
 * or the HTTP status), in human output and in `--json`. A load that legitimately
 * succeeds (a 404 with a body, 204, a CSP-blocked script) exits 0.
 *
 * Commands: `bdg URL` (start), `page navigate`, `page reload`, `dom click` on a
 * link and `dom submit` on a form that lead to the URL, `dom wait --load`,
 * `bdg console` after the load, and `attach` to a tab that shows it. They share
 * one Chrome that the test launches (start and attach reach it with
 * `--chrome-ws-url`, which skips only Chrome's launch); the in-session commands
 * share one session. A cell bdg cannot reach is skipped with the reason. Rows
 * without `full` run start and navigate only, in human output: the other commands
 * meet the same `net::` code of a row that has it. Rows with `full` also get
 * `--json` on start, navigate and click (the slow commands only for failures). A cell that fails the oracle today runs as
 * `todo` with the issue that tracks it: #860 (a `net::` error outside
 * `UNREACHABLE_ERRORS` reported as success), S25-pending (not filed yet).
 *
 * Known gaps: a self-signed or expired certificate (`ERR_CERT_*`, an interstitial)
 * needs a certificate the test would have to commit or generate; `attach` to a
 * tab whose navigation is still pending waits 30 s for Chrome to answer
 * `Page.enable` (the same hold as a start on a server that never answers).
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { startHostileServer, type HostileServer } from '@/__testutils__/hostileServer.js';
import {
  judge,
  ROWS,
  type Axis,
  type Observed,
  type ObservedJson,
  type Row,
} from '@/__testutils__/loadFailureCells.js';
import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import { CDPConnection } from '@/connection/cdp.js';
import { launchChrome } from '@/connection/launcher.js';
import type { CDPTarget, LaunchedChrome } from '@/types.js';

/** Shortest navigation limit bdg accepts from the test environment (`page navigate`, `reload`) */
const TEST_ENV = { BDG_TEST_PAGE_READY_MS: '1000' };

/** `--timeout` of the commands that wait on a page that never answers */
const WAIT_MS = '1500';

/** Why a row without `full` has no cell for an in-session command */
const LIMITED = 'budget: the row meets the same net error as a row that runs this command';

/** Why a row without an attach pattern has no attach cell */
const NO_ATTACH = 'one attach cell per kind of outcome (refused, TLS, a page that loads)';

let hostile: HostileServer;
let chrome: LaunchedChrome;

after(removeTempDirs);

/**
 * Run a bdg command.
 *
 * @param command - Command or URL
 * @param args - Arguments
 * @returns Exit code and output
 */
async function bdg(command: string, args: string[] = []): Promise<Observed> {
  const result = await runCommand(command, args, { timeout: 60_000, env: TEST_ENV });
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

/**
 * Run a bdg command with `--json`.
 *
 * @param command - Command or URL
 * @param args - Arguments
 * @returns Exit code and envelope
 */
async function bdgJson(command: string, args: string[] = []): Promise<ObservedJson> {
  const result = await runCommand(command, [...args, '--json'], { timeout: 60_000, env: TEST_ENV });
  const envelope = JSON.parse(result.stdout || '{}') as ObservedJson['envelope'];
  return { exitCode: result.exitCode, envelope };
}

/**
 * Run a cell and judge it: human output always, `--json` too when asked.
 *
 * @param row - The row
 * @param run - The command under test, with `--json` or without
 * @param prepare - Puts the session in the state the command starts from
 * @param withJson - Also run it with `--json`
 */
async function checkCell(
  row: Row,
  run: (json: boolean) => Promise<Observed | ObservedJson>,
  prepare: () => Promise<void>,
  withJson: boolean
): Promise<void> {
  await prepare();
  const human = (await run(false)) as Observed;
  let json: ObservedJson | undefined;
  if (withJson) {
    await prepare();
    json = (await run(true)) as ObservedJson;
  }
  const problems = judge(row.expect, human, json);
  assert.deepEqual(
    problems,
    [],
    `${row.id}\nhuman: ${JSON.stringify(human)}\njson: ${JSON.stringify(json)}`
  );
}

/**
 * What a command can tell about a row: `dom wait --load` and `attach` do not
 * report an HTTP status, so a page that loads is judged by its exit code alone.
 *
 * @param row - The row
 * @param statusless - The command does not report an HTTP status
 * @returns The row's expectation for that command
 */
function expectationFor(row: Row, statusless: boolean): Row['expect'] {
  return statusless && row.expect.kind === 'loads' ? { kind: 'loads' } : row.expect;
}

/**
 * Register one `it` per row for an axis: skipped with the reason when the
 * command cannot (or, for a row without `full`, need not) reach the row.
 *
 * @param axis - The command
 * @param cell - Runs one row
 * @param options - `full`: the axis runs on rows with `full` only; `flagged`: on rows with `console` only
 */
function cellsFor(
  axis: Axis,
  cell: (row: Row) => Promise<void>,
  options: { full?: boolean; flagged?: boolean } = {}
): void {
  for (const row of ROWS) {
    if (options.flagged && !row.console) continue;
    const reason = row.na?.[axis] ?? (options.full && !row.full ? LIMITED : undefined);
    void it(`${axis}: ${row.id}`, { skip: reason, todo: row.todo?.[axis] }, () => cell(row));
  }
}

/**
 * The URL of a row.
 *
 * @param row - The row
 * @returns Its URL
 */
function urlOf(row: Row): string {
  const url = row.url(hostile);
  assert.ok(url, `${row.id} has no URL`);
  return url;
}

/**
 * Whether a row is a failed load that gets the `--json` runs of the slow commands.
 *
 * @param row - The row
 * @returns True for a failure the matrix runs everywhere
 */
function failsLoad(row: Row): boolean {
  return row.full === true && row.expect.kind === 'failure';
}

/**
 * The page with the link and the form that lead to a row.
 *
 * @param row - The row
 * @returns Its URL
 */
function launchOf(row: Row): string {
  return row.launch ? row.launch(hostile) : hostile.launchUrl(urlOf(row));
}

void describe('Load-failure matrix', () => {
  before(async () => {
    await cleanupAllSessions();
    hostile = await startHostileServer();
    chrome = await launchChrome({
      port: await getFreePort(),
      userDataDir: makeTempDir('bdg-matrix-chrome-'),
      headless: true,
      sessionDir: makeTempDir('bdg-matrix-session-'),
    });
  });

  after(async () => {
    await cleanupAllSessions();
    await chrome.kill();
    await hostile.close();
  });

  void describe('bdg URL', () => {
    const startOn = async (url: string, json: boolean): Promise<Observed | ObservedJson> => {
      const args = ['--chrome-ws-url', String(chrome.port)];
      return json ? bdgJson(url, args) : bdg(url, args);
    };
    cellsFor('start', (row) =>
      checkCell(
        row,
        (json) => startOn(urlOf(row), json),
        async () => void (await bdg('stop')),
        failsLoad(row)
      )
    );
    after(async () => void (await bdg('stop')));
  });

  void describe('in a session', () => {
    before(async () => {
      await bdg('stop');
      const started = await bdg(`${hostile.url}ok`, ['--chrome-ws-url', String(chrome.port)]);
      assert.equal(started.exitCode, 0, started.output);
    });

    after(async () => void (await bdg('stop')));

    /**
     * Run one command on a row, from the state `reach` puts the session in.
     *
     * @param row - The row
     * @param command - Command
     * @param args - Arguments
     * @param reach - Puts the session in the state the command starts from
     * @param withJson - Also run it with `--json`
     */
    const runOn = (
      row: Row,
      command: string,
      args: string[],
      reach: (row: Row) => Promise<void>,
      withJson: boolean
    ): Promise<void> =>
      checkCell(
        { ...row, expect: expectationFor(row, args.includes('--load')) },
        (json) => (json ? bdgJson(command, args) : bdg(command, args)),
        () => reach(row),
        withJson
      );

    /** Navigate to the URL (without waiting for a page that never answers) */
    const reachUrl = async (row: Row): Promise<void> => {
      const wait = row.expect.kind === 'pending' ? ['--no-wait'] : [];
      await bdg('page', ['navigate', urlOf(row), ...wait]);
    };

    /** Navigate to the page with the link and the form */
    const reachLaunch = async (row: Row): Promise<void> => {
      const launched = await bdg('page', ['navigate', launchOf(row)]);
      assert.equal(launched.exitCode, 0, launched.output);
    };

    /** Leave a navigation a pending row left, which a second navigation to the same URL waits for */
    const reachAfterPending = async (row: Row): Promise<void> => {
      if (row.expect.kind === 'pending') await bdg('page', ['navigate', `${hostile.url}ok`]);
    };

    cellsFor('navigate', (row) =>
      runOn(row, 'page', ['navigate', urlOf(row)], reachAfterPending, row.full === true)
    );
    cellsFor('reload', (row) => runOn(row, 'page', ['reload'], reachUrl, false), { full: true });
    cellsFor('click', (row) => runOn(row, 'dom', ['click', '#go'], reachLaunch, failsLoad(row)), {
      full: true,
    });
    cellsFor(
      'submit',
      (row) => runOn(row, 'dom', ['submit', '#form', '--timeout', WAIT_MS], reachLaunch, false),
      { full: true }
    );
    cellsFor(
      'wait',
      (row) => runOn(row, 'dom', ['wait', '--load', '--timeout', WAIT_MS], reachUrl, false),
      { full: true }
    );
    cellsFor(
      'console',
      async (row) => {
        await reachUrl(row);
        const console = await bdg('console');
        assert.equal(console.exitCode, 0, console.output);
        assert.doesNotMatch(
          console.output,
          /No errors or warnings found/,
          `${row.id}: ${console.output}`
        );
      },
      { flagged: true }
    );
  });

  void describe('attach', () => {
    /**
     * Open a tab on a URL (without waiting for a load event, a failed load fires none).
     *
     * @param url - URL
     * @returns The tab
     */
    const openTab = async (url: string): Promise<CDPTarget> => {
      const response = await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, {
        method: 'PUT',
      });
      const tab = (await response.json()) as CDPTarget;
      const cdp = await CDPConnection.create(tab.webSocketDebuggerUrl);
      try {
        await cdp.send('Page.navigate', { url });
      } finally {
        cdp.close();
      }
      return tab;
    };

    before(async () => void (await bdg('stop')));

    for (const row of ROWS) {
      const reason = row.attach ? row.na?.attach : NO_ATTACH;
      void it(`attach: ${row.id}`, { skip: reason, todo: row.todo?.attach }, async () => {
        let tab: CDPTarget | undefined;
        const closeTab = async (): Promise<void> => {
          await bdg('stop');
          if (tab) await fetch(`http://127.0.0.1:${chrome.port}/json/close/${tab.id}`);
        };
        const attachTo = async (json: boolean): Promise<Observed | ObservedJson> => {
          tab = await openTab(urlOf(row));
          const args = [row.attach?.(hostile) ?? '', '--chrome-ws-url', String(chrome.port)];
          return json ? bdgJson('attach', args) : bdg('attach', args);
        };
        try {
          await checkCell({ ...row, expect: expectationFor(row, true) }, attachTo, closeTab, false);
        } finally {
          await closeTab();
        }
      });
    }
  });
});
