/**
 * `dom fill` reads the value again 2 s after filling (#892), smoke test.
 *
 * On `/fill-late-revert` some fields put their old value back 50 ms to
 * 1.5 s after the fill (a timer, a controlled input that rejects the value,
 * a checkbox unchecked, a select reset, a remount with the old value): the
 * fill fails with exit 90 and `valueMismatch`, as a synchronous revert does
 * (#867). Others reformat the value later (a phone mask, upper-casing,
 * trimming, an autocomplete), show only a validation message, remount
 * keeping the value, or change something else meanwhile (another field, a
 * ticker), or write it out differently (a date as `Jan 5, 2024`; also
 * unrelated text, a known limit: only the old value or a blank counts as a
 * revert): the fill succeeds. A field emptied later (a search box that
 * submits by itself) fails too, its suggestion saying the fill may have
 * taken effect. `--no-wait` reads the value only right after
 * the fill, as before.
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

/** Exit code of a fill whose value the page did not keep (RESOURCE_CONFLICT) */
const MISMATCH_EXIT = 90;

/** A matrix cell: what is filled where, and what the page leaves */
interface Cell {
  name: string;
  field: string;
  value: string;
  /** The page put back another value: the fill fails with exit 90, `actual` read back */
  reverted?: string;
  /** `expected` of the mismatch, when it is not the value given */
  expected?: string;
  /** What the suggestion of the failure says */
  suggestion?: RegExp;
  /** What the field shows formatted by the page (`data.pageValue`), when not the value given */
  pageValue?: string;
}

const CELLS: Cell[] = [
  { name: 'revert after 50 ms', field: '#r50', value: 'new', reverted: 'o' },
  { name: 'revert after 300 ms', field: '#r300', value: 'new', reverted: 'o' },
  { name: 'revert after 1500 ms', field: '#r1500', value: 'new', reverted: 'o' },
  {
    name: 'checkbox unchecked after 100 ms',
    field: '#cb',
    value: 'true',
    expected: 'checked',
    reverted: 'unchecked',
  },
  { name: 'select reset after 100 ms', field: '#sel', value: 'b', reverted: 'a' },
  { name: 'controlled input rejecting the value', field: '#ctl', value: 'abc', reverted: 'o' },
  { name: 'remount with the old value', field: '#remount-old', value: 'new', reverted: 'o' },
  {
    name: 'controlled input restoring its state over a DOM value with a space',
    field: '#ctl-space',
    value: 'new',
    reverted: 'o',
  },
  {
    name: 'search box emptied after submitting by itself',
    field: '#cleared',
    value: 'shoes',
    reverted: '',
    suggestion: /clears the field after an automatic submit/,
  },
  { name: 'late phone mask', field: '#phone', value: '5551234567', pageValue: '(555) 123-4567' },
  { name: 'upper-cased after blur', field: '#upper', value: 'abc', pageValue: 'ABC' },
  { name: 'trimmed after change', field: '#trim', value: 'abc ', pageValue: 'abc' },
  { name: 'autocomplete', field: '#auto', value: 'Lon', pageValue: 'London' },
  { name: 'validation message only', field: '#valid', value: 'foo' },
  { name: 'remount keeping the value', field: '#remount-keep', value: 'kept' },
  {
    name: 'date written out after change',
    field: '#datefmt',
    value: '2024-01-05',
    pageValue: 'Jan 5, 2024',
  },
  {
    name: 'replaced by unrelated text (known limit)',
    field: '#unrelated',
    value: 'new',
    pageValue: 'N/A',
  },
  { name: 'another field and a ticker changing', field: '#plain', value: 'hello' },
  { name: 'password upper-cased after change', field: '#pw', value: 'hunter22' },
];

/** What the tests read of the `--json` envelope of `dom fill` */
interface FillEnvelope {
  success: boolean;
  exitCode?: number;
  suggestion?: string;
  data?: { value?: string; pageValue?: string };
  valueMismatch?: { expected: string; actual: string };
}

let fixture: FixtureServer;

/**
 * Load the fixture page afresh, so each cell starts from the page's values.
 */
async function reload(): Promise<void> {
  const result = await runCommand('page', ['reload', '--json'], { timeout: 60000 });
  assert.equal(result.exitCode, 0, `${result.stdout}${result.stderr}`);
}

/**
 * Fill a field with `--json`.
 *
 * @param field - Selector of the field
 * @param value - Value to fill
 * @param flags - Extra `dom fill` flags
 * @returns Exit code and envelope
 */
async function fill(
  field: string,
  value: string,
  flags: string[] = []
): Promise<{ exitCode: number; envelope: FillEnvelope }> {
  const result = await runCommand('dom', ['fill', field, value, ...flags, '--json'], {
    timeout: 60000,
  });
  return { exitCode: result.exitCode, envelope: JSON.parse(result.stdout) as FillEnvelope };
}

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  const start = await runCommand(
    `${fixture.url}fill-late-revert`,
    ['--port', String(port), '--headless'],
    { timeout: 60000 }
  );
  assert.equal(start.exitCode, 0, `${start.stdout}${start.stderr}`);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

void describe('dom fill reads the value again 2 s after filling (#892)', () => {
  for (const cell of CELLS) {
    const outcome = cell.reverted === undefined ? 'succeeds' : 'fails with 90';
    void it(`${cell.name}: ${cell.value} into ${cell.field} ${outcome}`, async () => {
      await reload();
      const { exitCode, envelope } = await fill(cell.field, cell.value);
      if (cell.reverted === undefined) {
        assert.equal(exitCode, 0, JSON.stringify(envelope));
        assert.equal(envelope.valueMismatch, undefined);
        assert.equal(envelope.data?.pageValue, cell.pageValue);
        return;
      }
      assert.equal(exitCode, MISMATCH_EXIT, JSON.stringify(envelope));
      assert.deepEqual(envelope.valueMismatch, {
        expected: cell.expected ?? cell.value,
        actual: cell.reverted,
      });
      if (cell.suggestion) assert.match(envelope.suggestion ?? '', cell.suggestion);
    });
  }

  void it('--no-wait reads the value only right after the fill', async () => {
    await reload();
    const { exitCode, envelope } = await fill('#r300', 'new', ['--no-wait']);
    assert.equal(exitCode, 0, JSON.stringify(envelope));
  });

  void it('human output keeps the value given and adds what the page shows', async () => {
    await reload();
    const result = await runCommand('dom', ['fill', '#phone', '5551234567'], { timeout: 60000 });
    assert.equal(result.exitCode, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /Value:\s+5551234567$/m);
    assert.match(result.stdout, /Page shows:\s+\(555\) 123-4567$/m);
  });

  void it('never shows what a secret field holds after the page changed it', async () => {
    await reload();
    const human = await runCommand('dom', ['fill', '#pw', 'hunter22'], { timeout: 60000 });
    await reload();
    const { envelope } = await fill('#pw', 'hunter22');
    const output = `${human.stdout}${human.stderr}${JSON.stringify(envelope)}`;
    assert.equal(human.exitCode, 0, output);
    assert.doesNotMatch(output, /hunter22|HUNTER22|Page shows|pageValue/i);
  });
});
