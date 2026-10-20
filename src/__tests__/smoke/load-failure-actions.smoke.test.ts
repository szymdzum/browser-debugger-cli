/**
 * Load-failure matrix, actions (#862): `dom click` on a link and `dom submit` on
 * a form that lead to every row of `loadFailureCells.ts`, in one session of the
 * test's Chrome. The oracle and the rows are described in `loadFailureCells.ts`;
 * the other commands are in `load-failure-start.smoke.test.ts`.
 *
 * A failed load exits 80 with a ⚠ verdict naming the cause and the action's
 * data (`navigationFailed` in `--json`); a response that never ends is a ⚠
 * "still loading" with exit 0 (#873).
 */

import { after, before, describe } from 'node:test';

import {
  WAIT_MS,
  bdg,
  cellsFor,
  failsLoad,
  runAction,
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

  cellsFor('click', (row) => runAction(row, ['click', '#go'], failsLoad(row)), { full: true });
  cellsFor(
    'submit',
    (row) => runAction(row, ['submit', '#form', '--timeout', WAIT_MS], failsLoad(row)),
    { full: true }
  );
});
