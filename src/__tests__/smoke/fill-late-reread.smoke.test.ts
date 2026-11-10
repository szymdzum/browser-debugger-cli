/**
 * The read 500 ms after a late read of `dom fill` that judged the value
 * replaced (#906) is waited for in bdg, not by the page's timers (#940),
 * smoke test.
 *
 * Each page writes `draft-9f3ac2` 300 ms after the fill
 * (`/fill-reread-*`): the fill fails with exit 90 whether the page's timers
 * run, are frozen as fake timers freeze them, or the page navigates away or
 * runs a long script between the two reads (the first verdict stands). No
 * fill check is left on the page afterwards.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { startFixtureServer, type FixtureServer } from '@/__testutils__/fixtureServer.js';
import { createSharedSession } from '@/__testutils__/sharedSession.js';

/** Exit code of a fill whose value the page did not keep (RESOURCE_CONFLICT) */
const MISMATCH_EXIT = 90;

/** What the tests read of the `--json` envelope of `dom fill` */
interface FillEnvelope {
  valueMismatch?: { expected: string; actual: string };
}

let fixture: FixtureServer;

/** Opens a page in the file's one session */
const open = createSharedSession();

/**
 * Fill `#f` of a page with `Jane Smith`.
 *
 * @param page - Fixture path without the leading slash
 * @returns Exit code and envelope
 */
async function fillOn(page: string): Promise<{ exitCode: number; envelope: FillEnvelope }> {
  await open(`${fixture.url}${page}`);
  const result = await runCommand('dom', ['fill', '#f', 'Jane Smith', '--json'], {
    timeout: 60000,
  });
  return { exitCode: result.exitCode, envelope: JSON.parse(result.stdout) as FillEnvelope };
}

/**
 * What `window.__bdgFillCheck` is on the page now.
 *
 * @returns Its `typeof`
 */
async function fillCheckType(): Promise<string> {
  const result = await runCommand('eval', ['typeof window.__bdgFillCheck', '--json']);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  return String((JSON.parse(result.stdout) as { data?: { result?: unknown } }).data?.result);
}

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom fill keeps the replaced verdict when the second late read gets no answer (#940)', () => {
  for (const page of ['fill-reread-control', 'fill-reread-frozen']) {
    void it(`${page}: a draft written 300 ms after the fill fails with 90`, async () => {
      const { exitCode, envelope } = await fillOn(page);
      assert.equal(exitCode, MISMATCH_EXIT, JSON.stringify(envelope));
      assert.deepEqual(envelope.valueMismatch, { expected: 'Jane Smith', actual: 'draft-9f3ac2' });
      assert.equal(await fillCheckType(), 'undefined');
    });
  }

  void it('a page navigating away between the two reads keeps the first verdict: 90', async () => {
    const { exitCode, envelope } = await fillOn('fill-reread-navigates');
    assert.equal(exitCode, MISMATCH_EXIT, JSON.stringify(envelope));
    assert.equal(envelope.valueMismatch?.actual, 'draft-9f3ac2');
  });

  void it('a page busy at the second read keeps the first verdict, then drops the check: 90', async () => {
    const { exitCode, envelope } = await fillOn('fill-reread-busy');
    assert.equal(exitCode, MISMATCH_EXIT, JSON.stringify(envelope));
    assert.equal(envelope.valueMismatch?.actual, 'draft-9f3ac2');
    assert.equal(await fillCheckType(), 'undefined');
  });
});
