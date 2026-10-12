/**
 * Why a session ends after its page connection was lost (#487): a lost
 * connection with a known cause is not a closed page.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lossEndReason } from '@/daemon/session/Session.js';

void describe('lossEndReason', () => {
  void it('ends as disconnected when the connection names a cause and Chrome still runs', () => {
    assert.equal(lossEndReason('running', 'message-too-large'), 'disconnected');
    assert.equal(lossEndReason('running', 'no-pong'), 'disconnected');
    assert.equal(lossEndReason('unknown', 'socket-error'), 'disconnected');
  });

  void it('keeps closed for a running Chrome whose connection closed without a cause', () => {
    assert.equal(lossEndReason('running', undefined), 'closed');
  });

  void it('keeps crash when Chrome exited or an attached Chrome closed the connection', () => {
    assert.equal(lossEndReason('exited', 'socket-error'), 'crash');
    assert.equal(lossEndReason('exited', undefined), 'crash');
    assert.equal(lossEndReason('unknown', undefined), 'crash');
  });
});
