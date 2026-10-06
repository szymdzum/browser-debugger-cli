/**
 * Follow modes: nothing to follow without a session, and they stop when the
 * session they followed ends; other failures are reported (once in text, on
 * every refresh in JSON) and retried.
 */

import * as assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  handleDaemonConnectionError,
  noteFollowConnected,
} from '@/commands/shared/daemonErrorHandler.js';

void describe('handleDaemonConnectionError in follow mode', () => {
  void it('exits when no session ever answered, and reports a later loss once', () => {
    const errors = mock.method(console, 'error', () => undefined);
    try {
      assert.equal(
        handleDaemonConnectionError('No active session', { follow: true }).shouldExit,
        true
      );

      noteFollowConnected();
      const printed = errors.mock.callCount();
      const busy = { follow: true, exitCode: 102 };
      assert.equal(handleDaemonConnectionError('timed out', busy).shouldExit, false);
      const afterFirstLoss = errors.mock.callCount();
      handleDaemonConnectionError('timed out', busy);
      handleDaemonConnectionError('timed out', busy);

      assert.ok(afterFirstLoss > printed, 'the failure is reported');
      assert.equal(errors.mock.callCount(), afterFirstLoss, 'and only once');
    } finally {
      errors.mock.restore();
    }
  });

  void it('stops when the followed session ends, and prints one JSON line per failure', () => {
    const lines = mock.method(console, 'log', () => undefined);
    try {
      noteFollowConnected();
      const busy = { follow: true, json: true, exitCode: 102 };
      assert.equal(handleDaemonConnectionError('timed out', busy).shouldExit, false);
      assert.equal(handleDaemonConnectionError('timed out', busy).shouldExit, false);
      const ended = handleDaemonConnectionError('No active session', { follow: true, json: true });
      assert.deepEqual(ended, { shouldExit: true, exitCode: 83 });
      const printed = lines.mock.calls.map((call) => String(call.arguments[0]));
      assert.equal(printed.length, 3);
      assert.ok(
        printed.every((line) => !line.includes('\n')),
        'one object per line'
      );
      assert.match(
        printed[2] ?? '',
        /"error":"The session ended; stopped following","exitCode":83/
      );
    } finally {
      lines.mock.restore();
    }
  });
});
