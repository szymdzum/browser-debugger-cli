/**
 * Contract test: an invalid BDG_IPC_TIMEOUT_MS fails the command with exit 81
 * and a message naming the variable and the valid range, before any IPC call
 * (#657). It used to become NaN or 0 and time out at once.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { BdgResponse } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('BDG_IPC_TIMEOUT_MS validation', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-ipc-env-'));
  });

  afterEach(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  const run = (value: string, ...args: string[]): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', 'status', ...args], {
      encoding: 'utf8',
      env: { ...process.env, BDG_SESSION_DIR: sessionDir, BDG_IPC_TIMEOUT_MS: value },
    });

  for (const value of ['abc', '0', '-5', '1.5', '3000000000']) {
    void it(`exits 81 for BDG_IPC_TIMEOUT_MS="${value}"`, () => {
      const result = run(value);
      assert.equal(result.status, EXIT_CODES.INVALID_ARGUMENTS);
      assert.match(String(result.stderr), /BDG_IPC_TIMEOUT_MS/);
      assert.match(String(result.stderr), /2147483647/);
    });
  }

  void it('prints the --json envelope with the variable in the error', () => {
    const result = run('abc', '--json');
    assert.equal(result.status, EXIT_CODES.INVALID_ARGUMENTS);
    const envelope = JSON.parse(String(result.stdout)) as BdgResponse<unknown>;
    assert.equal(envelope.success, false);
    assert.match(String((envelope as { error?: string }).error), /BDG_IPC_TIMEOUT_MS/);
    assert.match(String((envelope as { suggestion?: string }).suggestion), /2147483647/);
  });

  void it('accepts a valid value', () => {
    assert.notEqual(run('2000').status, EXIT_CODES.INVALID_ARGUMENTS);
  });

  for (const value of ['abc', '0', '30s']) {
    for (const json of [false, true]) {
      void it(`bdg <url> with BDG_IPC_TIMEOUT_MS="${value}"${json ? ' --json' : ''} exits 81 and spawns no daemon`, () => {
        const result = spawnSync(
          process.execPath,
          ['--import', 'tsx', 'src/index.ts', 'http://localhost:9', ...(json ? ['--json'] : [])],
          {
            encoding: 'utf8',
            env: { ...process.env, BDG_SESSION_DIR: sessionDir, BDG_IPC_TIMEOUT_MS: value },
          }
        );
        assert.equal(result.status, EXIT_CODES.INVALID_ARGUMENTS);
        const output = json ? String(result.stdout) : String(result.stderr);
        assert.match(output, /BDG_IPC_TIMEOUT_MS/);
        assert.match(output, /2147483647/);
        assert.deepEqual(
          fs.readdirSync(sessionDir).filter((f) => /^daemon\./.test(f)),
          []
        );
      });
    }
  }
});
