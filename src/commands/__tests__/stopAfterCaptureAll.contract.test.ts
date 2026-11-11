/**
 * Contract cells of the #465 D7, D8 and D9 matrix, run through the CLI with
 * no session: human and `--json` x root and `attach`. A bad `--stop-after`
 * exits 81 on the start path (before anything is spawned) and on `attach`;
 * no warning. `cleanup --force` runs for real (no session: exit 0). The old
 * spellings were removed in 1.0 (exit 81: `renames.contract.test.ts`);
 * whether each flag takes effect is in `stopAfterCaptureAll.unit.test.ts`.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import type { BdgResponse } from '@/types.js';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const sessionDir = ensureTestSessionDir();
const ATTACH = ['attach', '0', '--chrome-ws-url', 'ws://127.0.0.1:1/devtools/browser/x'];
/** The validation error of a stop-after of 0, whichever spelling gave it */
const INVALID = /Invalid --stop-after: 0 is out of range/;

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
}

const CELLS: Cell[] = [
  { argv: ['http://localhost:1', '--stop-after', '0'], exit: 81 },
  { argv: [...ATTACH, '--stop-after', '0'], exit: 81 },
  { argv: ['http://localhost:1', '--capture-all', '--stop-after', '0'], exit: 81 },
  { argv: ['cleanup', '--force'], exit: 0 },
];

void describe('--stop-after, --capture-all and cleanup --force through the CLI (#465 D7, D8, D9)', () => {
  for (const cell of CELLS) {
    const line = `bdg ${cell.argv.join(' ')}`;

    void it(`${line}: exit ${cell.exit}, no warning`, async () => {
      const run = await runCli(cell.argv);
      assert.equal(run.status, cell.exit, run.stdout + run.stderr);
      if (cell.exit === 81) assert.match(run.stderr, INVALID);
      const warnings = run.stderr.split('\n').filter((l) => l.startsWith('Warning: '));
      assert.deepEqual(warnings, []);
    });

    void it(`${line} --json: no warnings in the envelope`, async () => {
      const run = await runCli([...cell.argv, '--json']);
      assert.equal(run.status, cell.exit, run.stdout + run.stderr);
      const envelope = JSON.parse(run.stdout.trim()) as BdgResponse & { warnings?: string[] };
      assert.equal(envelope.success, cell.exit === 0);
      if (cell.exit === 81) assert.match(envelope.error ?? '', INVALID);
      assert.equal(envelope.warnings, undefined);
    });
  }
});
