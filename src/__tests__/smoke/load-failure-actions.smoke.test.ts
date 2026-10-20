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

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  WAIT_MS,
  bdg,
  cellsFor,
  failsLoad,
  hostileServer,
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

  cellsFor('click', (row) => runAction(row, 'click', ['click', '#go'], failsLoad(row)), {
    full: true,
  });
  cellsFor(
    'submit',
    (row) => runAction(row, 'submit', ['submit', '#form', '--timeout', WAIT_MS], failsLoad(row)),
    { full: true }
  );

  void it('click: an iframe whose response never ends is no new page still loading', async () => {
    const server = hostileServer();
    await bdg('page', ['navigate', `${server.url}ok`]);
    const added = await bdg('eval', [
      `const b = document.createElement('button'); b.id = 'frame'; b.textContent = 'frame';
       b.onclick = () => { const f = document.createElement('iframe'); f.src = '/endless'; document.body.append(f); };
       document.body.append(b); 1`,
    ]);
    assert.equal(added.exitCode, 0, added.output);
    const clicked = await bdg('dom', ['click', '#frame']);
    assert.equal(clicked.exitCode, 0, clicked.output);
    assert.match(clicked.output, /\/endless → 200 \(loading\)/, clicked.output);
    assert.doesNotMatch(clicked.output, /new page still loading|navigation failed/, clicked.output);
  });
});
