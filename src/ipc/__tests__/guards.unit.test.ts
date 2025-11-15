/**
 * Protocol Guards Unit Tests
 *
 * Tests type guard behavior for command identification.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getCommandName, isCommandRequest, isCommandResponse } from '@/ipc/protocol/guards.js';

void describe('isCommandRequest', () => {
  void it('identifies all registered command requests', () => {
    const validCommands = ['worker_peek', 'worker_status', 'cdp_call', 'worker_details'];

    validCommands.forEach((cmd) => {
      assert.ok(isCommandRequest(`${cmd}_request`), `Should identify ${cmd}_request`);
    });
  });

  void it('rejects non-command requests', () => {
    const invalid = ['status_request', 'handshake_request', 'start_session_request'];

    invalid.forEach((type) => {
      const result = isCommandRequest(type);
      assert.equal(result, false, `Should reject ${type}`);
    });
  });

  void it('rejects malformed request types', () => {
    assert.ok(!isCommandRequest('worker_peek'));
    assert.ok(!isCommandRequest('worker_peek_response'));
    assert.ok(!isCommandRequest('invalid_request'));
  });
});

void describe('isCommandResponse', () => {
  void it('identifies all registered command responses', () => {
    const validCommands = ['worker_peek', 'worker_status', 'cdp_call', 'worker_details'];

    validCommands.forEach((cmd) => {
      const type = `${cmd}_response`;
      const result = isCommandResponse(type);
      assert.ok(result, `Should identify ${type}, got ${result}`);
    });
  });

  void it('rejects non-command responses', () => {
    const invalid = ['status_response', 'handshake_response', 'stop_session_response'];

    invalid.forEach((type) => {
      const result = isCommandResponse(type);
      assert.equal(result, false, `Should reject ${type}`);
    });
  });

  void it('rejects malformed response types', () => {
    assert.ok(!isCommandResponse('worker_peek'));
    assert.ok(!isCommandResponse('worker_peek_request'));
    assert.ok(!isCommandResponse('invalid_response'));
  });
});

void describe('getCommandName', () => {
  void it('extracts command name from request types', () => {
    assert.equal(getCommandName('worker_peek_request'), 'worker_peek');
    assert.equal(getCommandName('worker_status_request'), 'worker_status');
    assert.equal(getCommandName('cdp_call_request'), 'cdp_call');
  });

  void it('extracts command name from response types', () => {
    assert.equal(getCommandName('worker_peek_response'), 'worker_peek');
    assert.equal(getCommandName('worker_status_response'), 'worker_status');
    assert.equal(getCommandName('cdp_call_response'), 'cdp_call');
  });

  void it('returns null for non-command types', () => {
    assert.equal(getCommandName('status_request'), null);
    assert.equal(getCommandName('handshake_response'), null);
    assert.equal(getCommandName('invalid_type'), null);
  });

  void it('returns null for malformed types', () => {
    assert.equal(getCommandName('worker_peek'), null);
    assert.equal(getCommandName('_request'), null);
    assert.equal(getCommandName(''), null);
  });
});
