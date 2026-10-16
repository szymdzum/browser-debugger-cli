/**
 * Child environment of the smoke command runner: no child prints Node's
 * `NO_COLOR` / `FORCE_COLOR` conflict warning to stderr.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { childProcessEnv } from '@/__testutils__/commandRunner.js';

void describe('childProcessEnv', () => {
  /**
   * Run `fn` with `NO_COLOR` and `FORCE_COLOR` set, then restore them.
   *
   * @param fn - Function to run
   */
  function withColorVars(fn: () => void): void {
    const saved = { noColor: process.env['NO_COLOR'], forceColor: process.env['FORCE_COLOR'] };
    process.env['NO_COLOR'] = '1';
    process.env['FORCE_COLOR'] = '1';
    try {
      fn();
    } finally {
      for (const [name, value] of [
        ['NO_COLOR', saved.noColor],
        ['FORCE_COLOR', saved.forceColor],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it('drops NO_COLOR and FORCE_COLOR and keeps the rest', () => {
    withColorVars(() => {
      const env = childProcessEnv();
      assert.equal('NO_COLOR' in env, false);
      assert.equal('FORCE_COLOR' in env, false);
      assert.equal(env['PATH'], process.env['PATH']);
    });
  });

  it('keeps the colour warning off the stderr of a Node child', () => {
    withColorVars(() => {
      const child = spawnSync(process.execPath, ['-e', ''], {
        env: childProcessEnv(),
        encoding: 'utf8',
      });
      assert.equal(child.status, 0);
      assert.equal(child.stderr, '');
    });
  });
});
