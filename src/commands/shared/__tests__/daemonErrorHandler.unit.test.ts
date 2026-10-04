/**
 * Follow modes: nothing to follow without a session; a lost session is
 * reported once and retried.
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
      assert.equal(handleDaemonConnectionError('lost', { follow: true }).shouldExit, false);
      const afterFirstLoss = errors.mock.callCount();
      handleDaemonConnectionError('lost', { follow: true });
      handleDaemonConnectionError('lost', { follow: true });

      assert.ok(afterFirstLoss > printed, 'the loss is reported');
      assert.equal(errors.mock.callCount(), afterFirstLoss, 'and only once');
    } finally {
      errors.mock.restore();
    }
  });
});
