/**
 * IPC timeouts become exit 102 with a message that does not name internal
 * request types.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { timeoutError } from '@/commands/shared/CommandRunner.js';
import { getIPCRequestTimeout, getQuickIPCRequestTimeout } from '@/constants.js';
import { IPCTimeoutError } from '@/ipc/transport/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('timeoutError', () => {
  void it('reports a quick timeout as a session that does not respond', () => {
    const error = timeoutError(new IPCTimeoutError('handshake', getQuickIPCRequestTimeout()));
    assert.equal(error.exitCode, EXIT_CODES.CDP_TIMEOUT);
    assert.match(error.message, /did not respond/);
    assert.match(String(error.metadata.suggestion), /cleanup --force/);
  });

  void it('reports a long timeout as a command that did not finish', () => {
    const error = timeoutError(new IPCTimeoutError('dom_eval', getIPCRequestTimeout()));
    assert.equal(error.exitCode, EXIT_CODES.CDP_TIMEOUT);
    assert.match(error.message, /did not finish/);
    assert.doesNotMatch(error.message, /dom_eval/);
  });
});
