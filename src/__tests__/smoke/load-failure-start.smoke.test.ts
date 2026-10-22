/**
 * Load-failure matrix, loads (#862): `bdg URL`, `page navigate`, `page reload`,
 * `dom wait --load`, `bdg console` after the load, and `attach` to a tab that
 * shows every row of `loadFailureCells.ts`. Start and attach reach the test's
 * Chrome with `--chrome-ws-url`, which skips only Chrome's launch (the start path
 * is the same); the in-session commands share one session. A cell bdg cannot
 * reach is skipped with the reason. Rows without `full` run start and navigate
 * only, in human output: the other commands meet the same `net::` code of a row
 * that has it. Rows with `full` also get `--json` on start and navigate. A cell
 * that fails the oracle today runs as `todo` with the issue that tracks it. The
 * actions (`dom click`, `dom submit`) are in `load-failure-actions.smoke.test.ts`.
 *
 * Attach to a tab that shows a failed load succeeds with a warning naming it
 * (owner decision on #860): the tab is there to inspect, bdg did not load it.
 *
 * Known gaps: a self-signed or expired certificate (`ERR_CERT_*`, an
 * interstitial) needs a certificate the test would have to commit or generate;
 * `attach` to a tab whose navigation is still pending waits 30 s for Chrome to
 * answer `Page.enable` (the same hold as a start on a server that never answers).
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { ROWS, type Observed, type ObservedJson } from '@/__testutils__/loadFailureCells.js';
import {
  WAIT_MS,
  bdg,
  bdgJson,
  cellsFor,
  checkCell,
  chromePort,
  closeTab,
  expectationFor,
  failsLoad,
  hostileServer,
  openTab,
  reachUrl,
  runOn,
  setUpMatrix,
  startSession,
  tearDownMatrix,
  urlOf,
} from '@/__testutils__/loadFailureHarness.js';
import { removeTempDirs } from '@/__testutils__/tempDirs.js';
import type { CDPTarget } from '@/types.js';

/** Why a row without an attach pattern has no attach cell */
const NO_ATTACH = 'one attach cell per kind of outcome (refused, TLS, a page that loads)';

after(removeTempDirs);

void describe('Load-failure matrix: loads', () => {
  before(setUpMatrix);

  after(async () => {
    try {
      await bdg('stop');
    } finally {
      await tearDownMatrix();
    }
  });

  void describe('bdg URL', () => {
    cellsFor('start', (row) =>
      checkCell(
        row,
        (json) => {
          const args = ['--chrome-ws-url', String(chromePort())];
          return json ? bdgJson(urlOf(row), args) : bdg(urlOf(row), args);
        },
        async () => void (await bdg('stop')),
        failsLoad(row)
      )
    );
    after(async () => void (await bdg('stop')));
  });

  void describe('in a session', () => {
    before(startSession);
    after(async () => void (await bdg('stop')));

    /** Leave a navigation a pending row left, which a second navigation to the same URL waits for */
    const reachAfterPending = async (row: (typeof ROWS)[number]): Promise<void> => {
      if (row.expect.kind === 'pending')
        await bdg('page', ['navigate', `${hostileServer().url}ok`]);
    };

    cellsFor('navigate', (row) =>
      runOn(row, 'page', ['navigate', urlOf(row)], reachAfterPending, row.full === true)
    );
    cellsFor('reload', (row) => runOn(row, 'page', ['reload'], reachUrl, false), { full: true });
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
    before(async () => void (await bdg('stop')));

    for (const row of ROWS) {
      const reason = row.attach ? row.na?.attach : NO_ATTACH;
      void it(`attach: ${row.id}`, { skip: reason, todo: row.todo?.attach }, async () => {
        let tab: CDPTarget | undefined;
        const stopAndClose = async (): Promise<void> => {
          await bdg('stop');
          if (tab) await closeTab(tab.id);
        };
        const attachTo = async (json: boolean): Promise<Observed | ObservedJson> => {
          tab = await openTab(urlOf(row));
          const args = [
            row.attach?.(hostileServer()) ?? '',
            '--chrome-ws-url',
            String(chromePort()),
          ];
          return json ? bdgJson('attach', args) : bdg('attach', args);
        };
        try {
          const expect = expectationFor(row, true);
          const attached =
            expect.kind === 'failure' ? { kind: 'warns' as const, cause: expect.cause } : expect;
          await checkCell({ ...row, expect: attached }, attachTo, stopAndClose, true);
        } finally {
          await stopAndClose();
        }
      });
    }
  });
});
