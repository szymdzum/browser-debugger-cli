/**
 * Contract test: a usage error under `--json` prints exactly one JSON
 * envelope and no human usage block on either stream.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import type { BdgResponse } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('--json usage error', () => {
  void it('bdg dom a11y --json prints one JSON envelope, exit 81, no usage block', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', 'dom', 'a11y', '--json'],
      { encoding: 'utf8' }
    );

    assert.equal(run.status, EXIT_CODES.INVALID_ARGUMENTS);
    const envelope = JSON.parse(run.stdout) as BdgResponse<unknown>;
    assert.equal(envelope.success, false);
    assert.doesNotMatch(run.stderr, /Usage:/);
  });
});
