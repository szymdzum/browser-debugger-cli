/**
 * Load-failure matrix, actions (#862): `dom click` on a link and `dom submit` on
 * a form that lead to every row of `loadFailureCells.ts`, in one session of the
 * test's Chrome. The oracle and the rows are described in `loadFailureCells.ts`;
 * the other commands are in `load-failure-start.smoke.test.ts`.
 *
 * `dom submit` on a failed load is skipped: its result depends on whether the
 * network goes idle inside `--timeout` (nondeterministic until #873).
 */

import { after, before, describe } from 'node:test';

import {
  WAIT_MS,
  bdg,
  cellsFor,
  failsLoad,
  reachLaunch,
  runOn,
  setUpMatrix,
  startSession,
  tearDownMatrix,
} from '@/__testutils__/loadFailureHarness.js';
import { removeTempDirs } from '@/__testutils__/tempDirs.js';

after(removeTempDirs);

void describe('Load-failure matrix: actions', () => {
  before(async () => {
    await setUpMatrix();
    await startSession();
  });

  after(async () => {
    try {
      await bdg('stop');
    } finally {
      await tearDownMatrix();
    }
  });

  cellsFor('click', (row) => runOn(row, 'dom', ['click', '#go'], reachLaunch, failsLoad(row)), {
    full: true,
  });
  cellsFor(
    'submit',
    (row) => runOn(row, 'dom', ['submit', '#form', '--timeout', WAIT_MS], reachLaunch, false),
    { full: true }
  );
});
