/**
 * Unit tests for shared network request status labels.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatRequestStatus, getRequestState } from '@/ui/formatters/requestStatus.js';

void describe('request status', () => {
  void it('classifies pending, failed and completed requests', () => {
    assert.equal(getRequestState({}), 'pending');
    assert.equal(getRequestState({ status: 0 }), 'failed');
    assert.equal(getRequestState({ status: 503 }), 'complete');
  });

  void it('shows the HTTP status even when loading failed after the response', () => {
    assert.equal(
      formatRequestStatus({ status: 503, errorText: 'net::ERR_ABORTED' }),
      '503 (net::ERR_ABORTED)'
    );
    assert.equal(formatRequestStatus({ status: 200 }), '200');
  });

  void it('shows the failure reason for requests without a response', () => {
    assert.equal(
      formatRequestStatus({ status: 0, errorText: 'net::ERR_NAME_NOT_RESOLVED' }),
      'FAILED (net::ERR_NAME_NOT_RESOLVED)'
    );
    assert.equal(formatRequestStatus({ status: 0 }), 'FAILED (no response)');
    assert.equal(formatRequestStatus({}), 'pending');
  });
});
