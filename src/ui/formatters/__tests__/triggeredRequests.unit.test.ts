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
  formatTriggeredRequestsTitle,
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
    assert.equal(lines.at(-1), '... and 3 more (--json lists up to 50)');
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

void describe('formatTriggeredRequestLines with assets', () => {
  const page = triggered('checkout', { resourceType: 'Document', status: 200 });
  const api = triggered('api/cart', { method: 'POST', resourceType: 'Fetch', status: 201 });
  const socket = triggered('ws', { resourceType: 'WebSocket', status: 101 });
  const stylesheet = triggered('app.css', { resourceType: 'Stylesheet', status: 200 });
  const assets = [
    stylesheet,
    triggered('app.js', { resourceType: 'Script', status: 200 }),
    triggered('logo.png', { resourceType: 'Image', status: 200 }),
    triggered('font.woff2', { resourceType: 'Font', status: 200 }),
    triggered('manifest.json', { resourceType: 'Manifest', status: 200 }),
  ];

  void it('lists documents, API calls and sockets, and counts assets on one line', () => {
    const lines = formatTriggeredRequestLines([stylesheet, page, ...assets.slice(1), api, socket]);
    assert.deepEqual(lines, [
      'GET 127.0.0.1:8080/checkout → 200',
      'POST 127.0.0.1:8080/api/cart → 201',
      'GET 127.0.0.1:8080/ws → 101',
      '+ 5 assets (css, js, fonts, images, manifest)',
    ]);
  });

  void it('lists requests that are not GETs, pings and CSP reports', () => {
    const beacon = triggered('collect', { method: 'POST', resourceType: 'Other', status: 204 });
    const ping = triggered('ping', { method: 'POST', resourceType: 'Ping', status: 204 });
    const report = triggered('csp', { method: 'POST', resourceType: 'CSPViolationReport' });
    const other = triggered('favicon.ico', { resourceType: 'Other', status: 200 });
    assert.deepEqual(formatTriggeredRequestLines([beacon, ping, report, other]), [
      'POST 127.0.0.1:8080/collect → 204',
      'POST 127.0.0.1:8080/ping → 204',
      'POST 127.0.0.1:8080/csp → pending',
      '+ 1 asset (other)',
    ]);
  });

  void it('lists an asset that failed', () => {
    const missing = triggered('missing.png', { resourceType: 'Image', status: 404 });
    assert.deepEqual(formatTriggeredRequestLines([page, missing, stylesheet]), [
      'GET 127.0.0.1:8080/checkout → 200',
      'GET 127.0.0.1:8080/missing.png → 404',
      '+ 1 asset (css)',
    ]);
  });

  void it('adds up to the total in the title: rows, "more" and assets', () => {
    const calls = Array.from({ length: MAX_TRIGGERED_REQUESTS_SHOWN + 4 }, (_, i) =>
      triggered(`api/${i}`, { resourceType: 'XHR', status: 200 })
    );
    const requests = [...calls, ...assets];
    const lines = formatTriggeredRequestLines(requests, 2);
    const rows = lines.filter((line) => line.startsWith('GET ')).length;
    const more = Number(/\.\.\. and (\d+) more/.exec(lines.join('\n'))?.[1]);
    const assetCount = Number(/\+ (\d+) assets/.exec(lines.join('\n'))?.[1]);
    assert.equal(formatTriggeredRequestsTitle(requests, 2), 'Requests during the action (21):');
    assert.equal(rows + more + assetCount, 21);
  });
});
