/**
 * `dom fill` re-filling a field that already shows the page's format of the
 * value (#930), smoke test.
 *
 * On `/fill-refill` each field rewrites the value 300 ms after the input. A
 * second fill of the same value ends at the formatted text the field held
 * before it: that is the page formatting the value again, so both fills
 * succeed with `data.pageValue`. A field that puts back its old `0.00` after
 * `8.00` still fails with exit 90, the first time and again.
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
  success: boolean;
  data?: { value?: string; pageValue?: string };
  valueMismatch?: { expected: string; actual: string; replaced?: true };
}

let fixture: FixtureServer;

/** Opens the page in the file's one session */
const open = createSharedSession();

/**
 * Fill a field with `--json`.
 *
 * @param field - Selector of the field
 * @param value - Value to fill
 * @returns Exit code and envelope
 */
async function fill(
  field: string,
  value: string
): Promise<{ exitCode: number; envelope: FillEnvelope }> {
  const result = await runCommand('dom', ['fill', field, value, '--json'], { timeout: 60000 });
  return { exitCode: result.exitCode, envelope: JSON.parse(result.stdout) as FillEnvelope };
}

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom fill: a re-fill shown in the format of the earlier fill succeeds (#930)', () => {
  for (const [field, value, shown] of [
    ['#phone', '0612345678', '+33 6 12 34 56 78'],
    ['#amount', '8', '8,00'],
    ['#date', '2026-11-10', '10 November 2026'],
  ] as const) {
    void it(`${value} into ${field}, twice: both succeed showing ${shown}`, async () => {
      await open(`${fixture.url}fill-refill`);
      for (const round of ['first', 'second']) {
        const { exitCode, envelope } = await fill(field, value);
        assert.equal(exitCode, 0, `${round} fill: ${JSON.stringify(envelope)}`);
        assert.equal(envelope.valueMismatch, undefined, `${round} fill`);
        assert.equal(envelope.data?.pageValue, shown, `${round} fill`);
      }
    });
  }

  void it('8.00 into a field that puts back 0.00 fails with 90, twice', async () => {
    await open(`${fixture.url}fill-refill`);
    for (const round of ['first', 'second']) {
      const { exitCode, envelope } = await fill('#hours', '8.00');
      assert.equal(exitCode, MISMATCH_EXIT, `${round} fill: ${JSON.stringify(envelope)}`);
      assert.deepEqual(
        envelope.valueMismatch,
        { expected: '8.00', actual: '0.00' },
        `${round} fill`
      );
    }
  });
});
