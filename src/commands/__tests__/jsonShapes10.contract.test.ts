/**
 * Contract test (#844, 1.0 JSON shapes) for what needs no session:
 * `cleanup --json` has no `data.cleaned.output` (Q2), and the flag that keeps
 * the old per-batch `console --follow --json` envelopes for one minor,
 * `--json-batches`, needs `--follow` and excludes `--ndjson` (D16), both
 * checked before any session is looked up.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

import { ensureTestSessionDir } from '@/__testutils__/testHome.js';
import type { BdgResponse } from '@/types.js';

const sessionDir = ensureTestSessionDir();

/**
 * Run the CLI from source in an empty session dir and parse its envelope.
 *
 * @param argv - Arguments after `bdg`
 * @returns Exit code and the `--json` envelope
 */
function runJson(argv: string[]): Promise<{ code: number | null; envelope: BdgResponse }> {
  return new Promise((resolve) => {
    const env = { ...process.env, BDG_SESSION_DIR: sessionDir, CI: '1' };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...argv], { env });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.on('close', (code) =>
      resolve({ code, envelope: (stdout.trim() ? JSON.parse(stdout) : {}) as BdgResponse })
    );
  });
}

void describe('1.0 JSON shapes without a session', () => {
  void it('cleanup --json: data.cleaned has no output field', async () => {
    const { code, envelope } = await runJson(['cleanup', '--json']);
    assert.equal(code, 0);
    const cleaned = (envelope.data as { cleaned: Record<string, unknown> }).cleaned;
    assert.deepEqual(Object.keys(cleaned).sort(), ['chrome', 'daemons', 'session']);
  });

  void it('console --json-batches without --follow exits 81 naming --follow', async () => {
    const { code, envelope } = await runJson(['console', '--json-batches']);
    assert.equal(code, 81, JSON.stringify(envelope));
    assert.equal(envelope.success, false);
    assert.match(envelope.suggestion ?? '', /--follow/);
  });

  void it('console --follow --json-batches --ndjson exits 81', async () => {
    const { code, envelope } = await runJson(['console', '--follow', '--json-batches', '--ndjson']);
    assert.equal(code, 81, JSON.stringify(envelope));
    assert.match(envelope.error ?? '', /--json-batches.*--ndjson|--ndjson.*--json-batches/);
  });
});
