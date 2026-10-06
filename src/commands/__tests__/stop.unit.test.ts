/**
 * Unit tests for `bdg stop` waiting for the session's daemon to exit.
 */

import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';

import { waitForDaemonExit } from '@/commands/stop.js';

describe('waitForDaemonExit', () => {
  test('returns once the daemon has exited', async () => {
    const daemon = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], {
      stdio: 'ignore',
    });
    const pid = daemon.pid ?? 0;
    const exited = new Promise((resolve) => daemon.once('exit', resolve));

    const [warning] = await Promise.all([waitForDaemonExit(pid, 10000), exited]);

    assert.equal(warning, undefined);
  });

  test('does not wait without a daemon PID', async () => {
    assert.equal(await waitForDaemonExit(null, 10000), undefined);
  });

  test('warns when the daemon still runs after the wait', async () => {
    const daemon = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    try {
      const warning = await waitForDaemonExit(daemon.pid ?? 0, 100);

      assert.match(
        warning ?? '',
        new RegExp(
          `The daemon \\(PID ${daemon.pid}\\) was still shutting down after 0.1s; check with bdg sessions`
        )
      );
    } finally {
      daemon.kill('SIGKILL');
    }
  });
});
