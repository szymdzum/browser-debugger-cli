/**
 * A failed start waits (bounded) for the daemon it spawned to exit, so a
 * command run right after it does not see the session as still starting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { afterSpawnedDaemonExit, type StartOutcome } from '@/commands/shared/startHelpers.js';
import { waitUntil } from '@/utils/async.js';

const FAILURE: StartOutcome = {
  ok: false,
  error: 'Attach refused',
  human: 'Error: Attach refused',
  exitCode: 90,
};

void describe('waitUntil', () => {
  void it('returns as soon as the condition holds', async () => {
    let checks = 0;
    const started = Date.now();
    assert.equal(await waitUntil(() => ++checks >= 3, 1000, 5), true);
    assert.equal(checks, 3);
    assert.ok(Date.now() - started < 500);
  });

  void it('gives up after the timeout', async () => {
    const started = Date.now();
    assert.equal(await waitUntil(() => false, 60, 10), false);
    assert.ok(Date.now() - started >= 55);
  });
});

void describe('afterSpawnedDaemonExit', () => {
  void it('waits for the spawned daemon to exit before reporting the failure', async () => {
    let exited = false;
    setTimeout(() => (exited = true), 50);
    const outcome = await afterSpawnedDaemonExit(
      { ...FAILURE, spawned: { pid: 42, hasExited: () => exited } },
      2000
    );
    assert.equal(exited, true);
    assert.deepEqual(outcome, FAILURE);
  });

  void it('adds a hint when the daemon is still running after the wait', async () => {
    const outcome = await afterSpawnedDaemonExit(
      { ...FAILURE, spawned: { pid: 42, hasExited: () => false } },
      30
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.exitCode, 90);
    assert.match(outcome.human, /^Error: Attach refused\n.*PID 42.*still shutting down/);
    assert.match(String(outcome.details?.['daemonStillRunning']), /bdg cleanup --force/);
  });

  void it('does not wait without a spawned daemon or on success', async () => {
    const started = Date.now();
    assert.deepEqual(await afterSpawnedDaemonExit(FAILURE, 5000), FAILURE);
    assert.ok(Date.now() - started < 100);
  });
});
