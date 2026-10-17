/**
 * Contract cells of the #465 D7, D8 and D9 matrix, run through the CLI with
 * no session: old and new spelling x human and `--json` x root and `attach`.
 * A bad `--stop-after` exits 81 on the start path (before anything is
 * spawned) and on `attach`, as a bad `--timeout` did; an old spelling adds
 * one `Warning:` line on stderr, or one entry of `warnings` in the envelope
 * (and nothing on stderr); a new one adds none. `cleanup -f`, `--force` and
 * `--aggressive` run for real (no session: exit 0). Whether each flag takes
 * effect is in `stopAfterCaptureAll.unit.test.ts`.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import type { BdgResponse } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const sessionDir = ensureTestSessionDir();
const ATTACH = ['attach', '0', '--chrome-ws-url', 'ws://127.0.0.1:1/devtools/browser/x'];
/** The validation error of a stop-after of 0, whichever spelling gave it */
const INVALID = /Invalid --stop-after: 0 is out of range/;
const DEPRECATED = 'is deprecated and will be removed in 1.0';

/**
 * Run the CLI from source in an empty session dir (no session).
 *
 * @param argv - Arguments after `bdg`
 * @returns Exit status and both streams
 */
function runCli(argv: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const env = { ...process.env, BDG_SESSION_DIR: sessionDir, CI: '1' };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...argv], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

interface Cell {
  argv: string[];
  exit: number;
  warning?: string;
}

const CELLS: Cell[] = [
  { argv: ['http://localhost:1', '--stop-after', '0'], exit: 81 },
  {
    argv: ['http://localhost:1', '--timeout', '0'],
    exit: 81,
    warning:
      '"bdg <url> --timeout" is deprecated and will be removed in 1.0: use "bdg <url> --stop-after"',
  },
  {
    argv: ['http://localhost:1', '-t', '0'],
    exit: 81,
    warning:
      '"bdg <url> --timeout" is deprecated and will be removed in 1.0: use "bdg <url> --stop-after"',
  },
  { argv: [...ATTACH, '--stop-after', '0'], exit: 81 },
  {
    argv: [...ATTACH, '--timeout', '0'],
    exit: 81,
    warning:
      '"bdg attach --timeout" is deprecated and will be removed in 1.0: use "bdg attach --stop-after"',
  },
  { argv: ['http://localhost:1', '--capture-all', '--stop-after', '0'], exit: 81 },
  {
    argv: ['http://localhost:1', '-a', '--stop-after', '0'],
    exit: 81,
    warning:
      '"bdg <url> --all" is deprecated and will be removed in 1.0: use "bdg <url> --capture-all"',
  },
  {
    argv: ['http://localhost:1', '--all', '--stop-after', '0'],
    exit: 81,
    warning:
      '"bdg <url> --all" is deprecated and will be removed in 1.0: use "bdg <url> --capture-all"',
  },
  { argv: ['cleanup', '--force'], exit: 0 },
  {
    argv: ['cleanup', '-f'],
    exit: 0,
    warning: '"bdg cleanup -f" is deprecated and will be removed in 1.0: use "bdg cleanup --force"',
  },
  {
    argv: ['cleanup', '--aggressive'],
    exit: 0,
    warning:
      '"bdg cleanup --aggressive" is deprecated and will be removed in 1.0: use "bdg cleanup --force"',
  },
];

void describe('--stop-after, --capture-all and cleanup -f through the CLI (#465 D7, D8, D9)', () => {
  for (const cell of CELLS) {
    const line = `bdg ${cell.argv.join(' ')}`;

    void it(`${line}: exit ${cell.exit}, ${cell.warning ? 'one warning on stderr' : 'no warning'}`, async () => {
      const run = await runCli(cell.argv);
      assert.equal(run.status, cell.exit, run.stdout + run.stderr);
      if (cell.exit === 81) assert.match(run.stderr, INVALID);
      const warnings = run.stderr.split('\n').filter((l) => l.startsWith('Warning: '));
      assert.deepEqual(warnings, cell.warning ? [`Warning: ${cell.warning}`] : []);
    });

    void it(`${line} --json: warnings in the envelope, none on stderr`, async () => {
      const run = await runCli([...cell.argv, '--json']);
      assert.equal(run.status, cell.exit, run.stdout + run.stderr);
      const envelope = JSON.parse(run.stdout.trim()) as BdgResponse & { warnings?: string[] };
      assert.equal(envelope.success, cell.exit === 0);
      if (cell.exit === 81) assert.match(envelope.error ?? '', INVALID);
      assert.deepEqual(envelope.warnings, cell.warning ? [cell.warning] : undefined);
      assert.ok(!run.stderr.includes(DEPRECATED), run.stderr);
    });
  }

  void it('--stop-after with an old --timeout of another value exits 81 naming both', async () => {
    const run = await runCli(['http://localhost:1', '--stop-after', '5', '--timeout', '9']);
    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS, run.stderr);
    assert.match(run.stderr, /"bdg <url> --timeout" and "bdg <url> --stop-after"/);
  });

  void it('an old and a new spelling with the same value exit 0 with the old one warning', async () => {
    for (const argv of [
      ['cleanup', '--aggressive', '--force'],
      ['cleanup', '--aggressive', '-f'],
      ['cleanup', '--force', '-f'],
    ]) {
      const run = await runCli(argv);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.ok(run.stderr.includes('Warning: "bdg cleanup '), `${argv.join(' ')}: ${run.stderr}`);
    }
    const stop = await runCli(['http://localhost:1', '-t', '0', '--stop-after', '0']);
    assert.equal(stop.status, 81, stop.stderr);
    assert.match(stop.stderr, /Invalid --stop-after: 0 is out of range/);
    assert.ok(stop.stderr.includes('Warning: "bdg <url> --timeout"'), stop.stderr);
  });
});
