/**
 * The daemon's one shutdown order.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runShutdown, type ShutdownSteps } from '@/daemon/server/shutdown.js';

/**
 * Fake steps recording their order.
 *
 * @returns The steps and the recorded calls
 */
function recordingSteps(): { steps: ShutdownSteps; calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => (): Promise<void> => {
    calls.push(name);
    return Promise.resolve();
  };
  return {
    calls,
    steps: {
      refuseNewSessions: () => void calls.push('refuseNewSessions'),
      unpublish: () => void calls.push('unpublish'),
      stopSession: record('stopSession'),
      waitForInFlightRequests: record('waitForInFlightRequests'),
      flush: record('flush'),
      stopServer: record('stopServer'),
      exit: () => void calls.push('exit'),
    },
  };
}

void describe('runShutdown', () => {
  void it('unpublishes, stops the session, lets in-flight requests answer, then exits', async () => {
    const { steps, calls } = recordingSteps();
    await runShutdown(steps);
    assert.deepEqual(calls, [
      'refuseNewSessions',
      'unpublish',
      'stopSession',
      'waitForInFlightRequests',
      'flush',
      'stopServer',
      'exit',
    ]);
  });
});
