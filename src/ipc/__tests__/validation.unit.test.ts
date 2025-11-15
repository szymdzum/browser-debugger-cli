/**
 * Response Validation Unit Tests
 *
 * Tests response validation behavior.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateResponseType, validateSessionId } from '@/ipc/transport/validation.js';

void describe('validateSessionId', () => {
  void it('passes when session IDs match', () => {
    const request = { sessionId: '123' };
    const response = { sessionId: '123' };

    assert.doesNotThrow(() => {
      validateSessionId(request, response, 'test');
    });
  });

  void it('throws when session IDs mismatch', () => {
    const request = { sessionId: '123' };
    const response = { sessionId: '456' };

    assert.throws(
      () => {
        validateSessionId(request, response, 'status');
      },
      {
        message: /Response sessionId mismatch/,
      }
    );
  });

  void it('includes request name in error message', () => {
    const request = { sessionId: 'abc' };
    const response = { sessionId: 'xyz' };

    assert.throws(
      () => {
        validateSessionId(request, response, 'peek');
      },
      {
        message: /peek/,
      }
    );
  });
});

void describe('validateResponseType', () => {
  void it('passes when response type matches expected', () => {
    const response = { type: 'status_response' };

    assert.doesNotThrow(() => {
      validateResponseType(response, 'status_response', 'status');
    });
  });

  void it('throws when response type does not match expected', () => {
    const response = { type: 'peek_response' };

    assert.throws(
      () => {
        validateResponseType(response, 'status_response', 'status');
      },
      {
        message: /Unexpected response type.*peek_response.*expected.*status_response/i,
      }
    );
  });

  void it('includes request name in error message', () => {
    const response = { type: 'wrong_type' };

    assert.throws(
      () => {
        validateResponseType(response, 'expected_type', 'test_command');
      },
      {
        message: /test_command/,
      }
    );
  });
});
