/**
 * An interrupted command exits as shells expect: 130 for Ctrl-C, 143 for
 * SIGTERM, read from the reason of the aborted interrupt.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { interruptExitCode, interruptSignal } from '@/commands/shared/interrupt.js';

/**
 * An interrupt aborted by a signal.
 *
 * @param reason - The abort reason
 * @returns Aborted signal
 */
function abortedBy(reason: unknown): AbortSignal {
  const interrupt = new AbortController();
  interrupt.abort(reason);
  return interrupt.signal;
}

void describe('interrupt', () => {
  void it('exits 130 for SIGINT and 143 for SIGTERM', () => {
    assert.equal(interruptExitCode('SIGINT'), 130);
    assert.equal(interruptExitCode('SIGTERM'), 143);
  });

  void it('reads the signal from the abort reason, SIGINT unless SIGTERM', () => {
    assert.equal(interruptSignal(abortedBy('SIGTERM')), 'SIGTERM');
    assert.equal(interruptSignal(abortedBy('SIGINT')), 'SIGINT');
    assert.equal(interruptSignal(abortedBy(undefined)), 'SIGINT');
  });
});
