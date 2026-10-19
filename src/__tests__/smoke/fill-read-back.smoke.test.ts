/**
 * `dom fill` read-back (#867), smoke test.
 *
 * On `/fill-read-back` each field keeps, reformats or changes the value
 * filled. A plain number given to a text field is compared as the number the
 * field shows: `$8.00`, `5.20%` and `$1,234.50` are the numbers filled, so
 * the fill succeeds (exit 0, no `valueMismatch`). A value the page changed
 * (`8` raised to `24.00`, text emptied, a decimal comma `8,00`, a password
 * emptied) fails the fill with exit 90: the human error names both values,
 * and the `--json` error envelope carries `valueMismatch` with the fill's
 * other fields (`selector`, `element`). `--no-blur` reads the value before
 * the field reformats it on blur, so it succeeds too.
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

/** A matrix cell: what is filled where, and what the page keeps */
interface Cell {
  field: string;
  value: string;
  /** Extra `dom fill` flags */
  flags?: string[];
  /** Value the field holds after the fill, or the masked mismatch of a secret field */
  kept: string;
  /** The page changed the value: the fill fails with exit 90 */
  mismatch: boolean;
  /** Line the human error starts with, for a mismatch */
  error?: RegExp;
}

const CELLS: Cell[] = [
  { field: '#num', value: '8', kept: '8', mismatch: false },
  { field: '#num-clamp', value: '8', kept: '24', mismatch: true },
  { field: '#money', value: '8', kept: '$8.00', mismatch: false },
  { field: '#money', value: '1234.5', kept: '$1,234.50', mismatch: false },
  { field: '#money', value: '8', flags: ['--no-blur'], kept: '8', mismatch: false },
  { field: '#money', value: 'abc', kept: '', mismatch: true },
  { field: '#pct', value: '5.2', kept: '5.20%', mismatch: false },
  { field: '#clamp', value: '8', kept: '24.00', mismatch: true },
  { field: '#eu', value: '8', kept: '8,00', mismatch: true },
  { field: '#plain', value: '8', kept: '8', mismatch: false },
  { field: '#plain', value: 'abc', kept: 'abc', mismatch: false },
  {
    field: '#pin',
    value: '1234',
    kept: '••••',
    mismatch: true,
    error: /secret field, value not shown/,
  },
];

/** What the tests read of the `--json` envelope of `dom fill` */
interface FillEnvelope {
  success: boolean;
  exitCode?: number;
  error?: string;
  suggestion?: string;
  selector?: string;
  element?: string;
  valueMismatch?: { expected: string; actual: string; masked?: true };
  data?: { value?: string; valueMismatch?: unknown };
}

let fixture: FixtureServer;

before(async () => {
  await cleanupAllSessions();
  fixture = await startFixtureServer();
  const port = await getFreePort();
  const start = await runCommand(
    `${fixture.url}fill-read-back`,
    ['--port', String(port), '--headless'],
    { timeout: 60000 }
  );
  assert.equal(start.exitCode, 0, `${start.stdout}${start.stderr}`);
});

after(async () => {
  await cleanupAllSessions();
  await fixture.close();
});

/**
 * Name of a cell in the test titles.
 *
 * @param cell - Matrix cell
 * @returns e.g. `8 into #clamp`
 */
function cellName(cell: Cell): string {
  return `${cell.value} into ${cell.field}${cell.flags ? ` ${cell.flags.join(' ')}` : ''}`;
}

/**
 * The human error line of a mismatch.
 *
 * @param cell - Matrix cell
 * @returns Pattern of the line
 */
function errorLine(cell: Cell): RegExp {
  if (cell.error) return cell.error;
  const quote = (text: string): string => text.replace(/[$.*+?()[\]{}|^\\]/g, '\\$&');
  return new RegExp(
    `The field's value is "${quote(cell.kept)}" after filling \\(expected "${quote(cell.value)}"\\)`
  );
}

void describe('dom fill read-back: numbers in formatted text fields, exit 90 on a mismatch (#867)', () => {
  for (const cell of CELLS) {
    void it(`human: ${cellName(cell)} ${cell.mismatch ? 'fails with 90' : 'succeeds'}`, async () => {
      const result = await runCommand('dom', ['fill', cell.field, cell.value, ...(cell.flags ?? [])], {
        timeout: 60000,
      });
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.exitCode, cell.mismatch ? MISMATCH_EXIT : 0, output);
      if (cell.mismatch) {
        assert.match(result.stderr, errorLine(cell), output);
      } else {
        assert.doesNotMatch(output, /after filling|value not shown/, output);
      }
    });

    void it(`--json: ${cellName(cell)} ${cell.mismatch ? 'is an error envelope with valueMismatch' : 'has no valueMismatch'}`, async () => {
      const result = await runCommand(
        'dom',
        ['fill', cell.field, cell.value, ...(cell.flags ?? []), '--json'],
        { timeout: 60000 }
      );
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.exitCode, cell.mismatch ? MISMATCH_EXIT : 0, output);
      const envelope = JSON.parse(result.stdout) as FillEnvelope;
      if (!cell.mismatch) {
        assert.equal(envelope.success, true, output);
        assert.equal(envelope.data?.valueMismatch, undefined, output);
        assert.equal(envelope.data?.value, cell.field === '#pin' ? '••••' : cell.kept, output);
        return;
      }
      assert.equal(envelope.success, false, output);
      assert.equal(envelope.exitCode, MISMATCH_EXIT, output);
      assert.match(envelope.error ?? '', errorLine(cell), output);
      assert.ok(envelope.suggestion, `suggestion: ${output}`);
      assert.equal(envelope.selector, cell.field, output);
      assert.ok(envelope.element, `element: ${output}`);
      const secret = cell.field === '#pin';
      assert.deepEqual(
        envelope.valueMismatch,
        secret
          ? { expected: '••••', actual: '', masked: true }
          : { expected: cell.value, actual: cell.kept },
        output
      );
    });
  }
});
