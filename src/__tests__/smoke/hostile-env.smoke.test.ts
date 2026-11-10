/**
 * Actions give the verdict of an unperturbed page when the page's timers are
 * frozen or slowed (#940), smoke test.
 *
 * The page (`/hostile?case=NAME&perturb=NAME`, `hostileEnvFixtures.ts`) keeps
 * its own behaviour on the real timers while `window.setTimeout` and
 * `window.setInterval` are replaced, as fake timers or a throttled background
 * tab do. Each cell is one action with a known outcome, written as literals
 * (the verdict the same page gives with running timers), plus the page's real
 * state read with `eval` after the command returned. `fakeTimersAll` (it
 * freezes the clock too, which slows `page navigate`, #941) and a dead
 * `MessageChannel` (a known limit of the fill read-back) are not covered.
 */

import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { startFixtureServer, type FixtureServer } from '@/__testutils__/fixtureServer.js';
import { createSharedSession } from '@/__testutils__/sharedSession.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Perturbations of the page's timers */
type Perturbation = 'frozenTimers' | 'slowTimers';

const PERTURBATIONS: readonly Perturbation[] = ['frozenTimers', 'slowTimers'];

/** What the cells read of a command's `--json` envelope */
interface Envelope {
  success?: boolean;
  error?: string;
  data?: {
    value?: string;
    count?: number;
    text?: string;
    effect?: string;
    shown?: { text: string }[];
    navigation?: { url: string; sameDocument: boolean };
    navigationOccurred?: boolean;
    triggeredRequests?: { url: string; status: number }[];
  };
  valueMismatch?: { expected: string; actual: string };
}

/** One action with a known outcome */
interface Cell {
  name: string;
  argv: string[];
  exitCode: number;
  verdict: (envelope: Envelope) => void;
  probe: string;
  truth: string;
  skip?: Perturbation[];
}

/**
 * Verdict of a fill the page did not keep.
 *
 * @param actual - Value the field holds
 * @returns Check of the envelope
 */
const mismatch =
  (actual: string) =>
  (envelope: Envelope): void =>
    assert.deepEqual(envelope.valueMismatch, { expected: 'Jane Smith', actual });

/**
 * Verdict of an action that showed one element.
 *
 * @param text - Text of the element shown
 * @returns Check of the envelope
 */
const shown =
  (text: string) =>
  (envelope: Envelope): void =>
    assert.deepEqual(
      envelope.data?.shown?.map((item) => item.text),
      [text]
    );

/** Page-side text of `#r`, the element the cases add */
const RESULT_TEXT = "String(document.getElementById('r')?.textContent)";

const CLICK = ['#b'];
const FILL = ['#f', 'Jane Smith'];
const WAIT_LIMIT = ['--timeout', '5000'];

const CELLS: readonly Cell[] = [
  {
    name: 'click-sync',
    argv: ['dom', 'click', ...CLICK],
    exitCode: 0,
    verdict: shown('Saved 123'),
    probe: RESULT_TEXT,
    truth: 'Saved 123',
  },
  {
    name: 'click-late',
    argv: ['dom', 'click', ...CLICK],
    exitCode: 0,
    verdict: shown('Saved 123'),
    probe: RESULT_TEXT,
    truth: 'Saved 123',
  },
  {
    name: 'click-noop',
    argv: ['dom', 'click', ...CLICK],
    exitCode: 0,
    verdict: (envelope) => assert.equal(envelope.data?.effect, 'none'),
    probe: RESULT_TEXT,
    truth: 'undefined',
  },
  {
    name: 'click-value',
    argv: ['dom', 'click', ...CLICK],
    exitCode: 0,
    verdict: (envelope) => {
      assert.equal(envelope.data?.shown, undefined);
      assert.equal(envelope.data?.navigation, undefined);
    },
    probe: "document.getElementById('f').value",
    truth: 'set by click',
  },
  {
    name: 'click-fetch',
    argv: ['dom', 'click', ...CLICK],
    exitCode: 0,
    verdict: (envelope) => {
      shown('Loaded 456')(envelope);
      const request = envelope.data?.triggeredRequests?.find((r) => r.url.endsWith('/hostile-api'));
      assert.equal(request?.status, 200, JSON.stringify(envelope.data?.triggeredRequests));
    },
    probe: RESULT_TEXT,
    truth: 'Loaded 456',
  },
  {
    name: 'click-nav',
    argv: ['dom', 'click', ...CLICK],
    exitCode: 0,
    verdict: (envelope) => {
      assert.ok(
        envelope.data?.navigation?.url.endsWith('/hostile-done'),
        JSON.stringify(envelope.data)
      );
      assert.equal(envelope.data?.navigation?.sameDocument, false);
    },
    probe: 'location.pathname',
    truth: '/hostile-done',
  },
  {
    name: 'press-enter',
    argv: ['dom', 'press-key', '#f', 'Enter'],
    exitCode: 0,
    verdict: shown('Entered'),
    probe: RESULT_TEXT,
    truth: 'Entered',
  },
  {
    name: 'submit-ok',
    argv: ['dom', 'submit', '#s'],
    exitCode: 0,
    verdict: (envelope) => {
      assert.equal(envelope.data?.navigationOccurred, true);
      assert.ok(
        envelope.data?.navigation?.url.endsWith('/hostile-done?q=x'),
        JSON.stringify(envelope.data)
      );
    },
    probe: 'location.pathname + location.search',
    truth: '/hostile-done?q=x',
  },
  {
    name: 'submit-blocked',
    argv: ['dom', 'submit', '#s'],
    exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    verdict: (envelope) => assert.match(envelope.error ?? '', /invalid fields - q:/),
    probe: 'location.pathname',
    truth: '/hostile',
  },
  {
    name: 'wait-appears',
    argv: ['dom', 'wait', '#late', ...WAIT_LIMIT],
    exitCode: 0,
    verdict: (envelope) => assert.equal(envelope.data?.count, 1),
    probe: "String(document.getElementById('late')?.textContent)",
    truth: 'here',
  },
  {
    name: 'wait-text',
    argv: ['dom', 'wait', '#s', '--text', 'Ready', ...WAIT_LIMIT],
    exitCode: 0,
    verdict: (envelope) => assert.equal(envelope.data?.text, 'Ready'),
    probe: "document.getElementById('s').textContent",
    truth: 'Ready',
  },
  {
    name: 'wait-never',
    argv: ['dom', 'wait', '#never', '--timeout', '1500'],
    exitCode: EXIT_CODES.CDP_TIMEOUT,
    verdict: (envelope) => assert.match(envelope.error ?? '', /Timed out .* waiting for #never/),
    probe: "String(document.getElementById('never'))",
    truth: 'null',
  },
  {
    name: 'fill-keep',
    argv: ['dom', 'fill', ...FILL],
    exitCode: 0,
    verdict: (envelope) => {
      assert.equal(envelope.data?.value, 'Jane Smith');
      assert.equal(envelope.valueMismatch, undefined);
    },
    probe: "document.getElementById('f').value",
    truth: 'Jane Smith',
  },
  {
    name: 'fill-restore',
    argv: ['dom', 'fill', ...FILL],
    exitCode: EXIT_CODES.RESOURCE_CONFLICT,
    verdict: mismatch('old value'),
    probe: "document.getElementById('f').value",
    truth: 'old value',
  },
  {
    name: 'fill-reject-sync',
    argv: ['dom', 'fill', ...FILL],
    exitCode: EXIT_CODES.RESOURCE_CONFLICT,
    verdict: mismatch(''),
    probe: "document.getElementById('f').value",
    truth: '',
  },
  {
    name: 'fill-replace',
    argv: ['dom', 'fill', ...FILL],
    exitCode: EXIT_CODES.RESOURCE_CONFLICT,
    verdict: mismatch('draft-9f3ac2'),
    probe: "document.getElementById('f').value",
    truth: 'draft-9f3ac2',
    skip: ['frozenTimers'],
  },
];

let fixture: FixtureServer;

/** Opens a page in the file's one session */
const open = createSharedSession();

/**
 * Run a `dom` or `eval` command and parse its `--json` envelope.
 *
 * @param argv - Command name and its arguments
 * @returns Exit code and envelope
 */
async function runJson(argv: string[]): Promise<{ exitCode: number; envelope: Envelope }> {
  const result = await runCommand(argv[0] ?? '', [...argv.slice(1), '--json'], { timeout: 60000 });
  const envelope = JSON.parse(result.stdout) as Envelope;
  return { exitCode: result.exitCode, envelope };
}

/**
 * Read the page's state after a command returned.
 *
 * @param expression - Page expression returning a string
 * @returns The string
 */
async function readPage(expression: string): Promise<string> {
  const result = await runCommand('eval', [expression, '--json']);
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

void describe('actions under frozen and slowed page timers give the verdict of running timers (#940)', () => {
  for (const cell of CELLS) {
    for (const perturbation of PERTURBATIONS) {
      if (cell.skip?.includes(perturbation)) continue;
      void it(`${cell.name} × ${perturbation}`, async () => {
        await open(`${fixture.url}hostile?case=${cell.name}&perturb=${perturbation}`);
        const { exitCode, envelope } = await runJson(cell.argv);
        assert.equal(exitCode, cell.exitCode, JSON.stringify(envelope));
        assert.equal(envelope.success ?? true, cell.exitCode === 0, JSON.stringify(envelope));
        cell.verdict(envelope);
        assert.equal(await readPage(cell.probe), cell.truth);
      });
    }
  }
});
