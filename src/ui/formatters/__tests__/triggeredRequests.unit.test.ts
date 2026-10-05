/**
 * Human output of the requests a DOM action triggered.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import {
  MAX_TRIGGERED_REQUESTS_SHOWN,
  formatTriggeredRequest,
  formatTriggeredRequestLines,
} from '@/ui/formatters/triggeredRequests.js';

/**
 * Build a triggered request.
 *
 * @param path - URL path
 * @param fields - Fields to set
 * @returns Request
 */
function triggered(path: string, fields: Partial<TriggeredRequest> = {}): TriggeredRequest {
  return { requestId: path, method: 'GET', url: `http://127.0.0.1:8080/${path}`, ...fields };
}

void describe('formatTriggeredRequest', () => {
  void it('shows method, compact URL, status and duration', () => {
    assert.equal(
      formatTriggeredRequest(
        triggered('api/save', { method: 'POST', status: 201, durationMs: 85 })
      ),
      'POST 127.0.0.1:8080/api/save → 201 (85ms)'
    );
    assert.equal(
      formatTriggeredRequest(triggered('slow', { status: 200, durationMs: 1234 })),
      'GET 127.0.0.1:8080/slow → 200 (1.2s)'
    );
  });

  void it('shows pending and failed requests', () => {
    assert.equal(
      formatTriggeredRequest(triggered('poll', { pending: true })),
      'GET 127.0.0.1:8080/poll → pending'
    );
    assert.equal(
      formatTriggeredRequest(
        triggered('down', { failed: true, errorText: 'net::ERR_CONNECTION_REFUSED', durationMs: 3 })
      ),
      'GET 127.0.0.1:8080/down → FAILED (net::ERR_CONNECTION_REFUSED) (3ms)'
    );
  });
});

void describe('formatTriggeredRequest loading', () => {
  void it('shows a response whose body is still loading as not finished', () => {
    assert.equal(
      formatTriggeredRequest(triggered('events', { status: 200, loading: true })),
      'GET 127.0.0.1:8080/events → 200 (loading)'
    );
  });
});

void describe('formatTriggeredRequestLines', () => {
  void it('lists the first requests and says how many more there are', () => {
    const requests = Array.from({ length: MAX_TRIGGERED_REQUESTS_SHOWN + 3 }, (_, i) =>
      triggered(`r${i}`, { status: 200 })
    );
    const lines = formatTriggeredRequestLines(requests);
    assert.equal(lines.length, MAX_TRIGGERED_REQUESTS_SHOWN + 1);
    assert.equal(lines.at(-1), '... and 3 more (use --json for all)');
  });

  void it('points to the network list when JSON left requests out too', () => {
    const requests = Array.from({ length: 50 }, (_, i) => triggered(`r${i}`, { status: 200 }));
    assert.equal(
      formatTriggeredRequestLines(requests, 10).at(-1),
      '... and 50 more (see bdg network list)'
    );
  });

  void it('is empty without requests', () => {
    assert.deepEqual(formatTriggeredRequestLines([]), []);
  });
});
