/**
 * Contract test (#465 Q1, #844): `bdg sessions --include-sensitive --json`
 * writes a command warning with no session needed; it is only in `warnings`
 * (1.0 dropped the envelope's `warning` string field).
 * With an old spelling too, `warnings` has the old spelling first.
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
 * @returns The `--json` envelope
 */
function runJson(argv: string[]): Promise<BdgResponse> {
  return new Promise((resolve) => {
    const env = { ...process.env, BDG_SESSION_DIR: sessionDir, CI: '1' };
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...argv], { env });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.on('close', () => resolve(JSON.parse(stdout) as BdgResponse));
  });
}

void describe('warnings in the envelope', () => {
  void it('sessions --include-sensitive: the warning is the only entry of warnings', async () => {
    const envelope = await runJson(['sessions', '--include-sensitive', '--json']);
    assert.equal(envelope.warnings?.length, 1);
    assert.match(envelope.warnings?.[0] ?? '', /credentials/i);
    assert.ok(!('warning' in envelope));
  });

  void it('sessions without the flag: neither field', async () => {
    const envelope = await runJson(['sessions', '--json']);
    assert.ok(!('warning' in envelope));
    assert.ok(!('warnings' in envelope));
  });
});
