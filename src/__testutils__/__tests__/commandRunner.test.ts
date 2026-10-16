/**
 * Child environment of the smoke command runner: no child prints Node's
 * `NO_COLOR` / `FORCE_COLOR` conflict warning to stderr.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';

void describe('runCommand environment', () => {
  it('keeps the NO_COLOR/FORCE_COLOR warning off stderr', async () => {
    const saved = { noColor: process.env['NO_COLOR'], forceColor: process.env['FORCE_COLOR'] };
    process.env['NO_COLOR'] = '1';
    process.env['FORCE_COLOR'] = '1';
    try {
      const result = await runCommand('--version');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, '');
    } finally {
      for (const [name, value] of [
        ['NO_COLOR', saved.noColor],
        ['FORCE_COLOR', saved.forceColor],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
