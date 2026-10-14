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

void describe('formatTriggeredRequestLines with repeated requests', () => {
  const beacon = (i: number, fields: Partial<TriggeredRequest> = {}): TriggeredRequest => ({
    ...triggered(`event?s=${i}`, { method: 'POST', resourceType: 'Other', status: 501 }),
    requestId: `b${i}`,
    ...fields,
  });
  const beacons = (count: number, fields: Partial<TriggeredRequest> = {}): TriggeredRequest[] =>
    Array.from({ length: count }, (_, i) => beacon(i, fields));

  void it('shows requests with the same method, host and path as one row, query ignored', () => {
    assert.deepEqual(formatTriggeredRequestLines(beacons(8)), [
      'POST 127.0.0.1:8080/event ×8 → 501',
    ]);
  });

  void it('leaves single requests as they are, in the order the groups first appeared', () => {
    const one = triggered('api/cart', {
      method: 'POST',
      resourceType: 'Fetch',
      status: 201,
      durationMs: 85,
    });
    const two = triggered('api/list', { resourceType: 'Fetch', status: 200 });
    assert.deepEqual(formatTriggeredRequestLines([one, ...beacons(2), two, beacon(9)]), [
      'POST 127.0.0.1:8080/api/cart → 201 (85ms)',
      'POST 127.0.0.1:8080/event ×3 → 501',
      'GET 127.0.0.1:8080/api/list → 200',
    ]);
  });

  void it('does not group a different method or path', () => {
    const get = triggered('event?s=1', { resourceType: 'Fetch', status: 200 });
    const other = triggered('event/2', { method: 'POST', resourceType: 'Other', status: 501 });
    assert.equal(formatTriggeredRequestLines([...beacons(2), get, other]).length, 3);
  });

  void it('shows differing statuses compactly in the order they first appeared', () => {
    const requests = [...beacons(2, { status: 200 }), beacon(2), ...beacons(1, { status: 200 })];
    assert.deepEqual(formatTriggeredRequestLines(requests), [
      'POST 127.0.0.1:8080/event → 200 ×3, 501 ×1',
    ]);
  });

  void it('names failures and pending requests in a group', () => {
    const requests = [
      beacon(0, { failed: true, errorText: 'net::ERR_ABORTED' }),
      beacon(1, { failed: true, errorText: 'net::ERR_ABORTED' }),
      triggered('event?s=2', { method: 'POST', resourceType: 'Other', pending: true }),
    ];
    assert.deepEqual(formatTriggeredRequestLines(requests), [
      'POST 127.0.0.1:8080/event → FAILED (net::ERR_ABORTED) ×2, pending ×1',
    ]);
  });

  void it('caps grouped rows, and counts the requests that are not shown', () => {
    const rows = Array.from({ length: MAX_TRIGGERED_REQUESTS_SHOWN + 1 }, (_, i) =>
      triggered(`r${i}`, { resourceType: 'Fetch', status: 200 })
    );
    const lines = formatTriggeredRequestLines([
      ...beacons(8),
      ...rows,
      ...beacons(2).map((b) => ({ ...b, url: 'http://127.0.0.1:8080/late' })),
    ]);
    assert.equal(lines.length, MAX_TRIGGERED_REQUESTS_SHOWN + 1);
    assert.equal(lines[0], 'POST 127.0.0.1:8080/event ×8 → 501');
    assert.equal(lines.at(-1), '... and 4 more (--json lists up to 50)');
  });

  void it('groups the same host and path across schemes, not across hosts or ports', () => {
    const at = (url: string): TriggeredRequest => ({
      requestId: url,
      method: 'POST',
      url,
      resourceType: 'Other',
      status: 200,
    });
    assert.deepEqual(formatTriggeredRequestLines([at('http://h/e'), at('https://h/e')]), [
      'POST h/e ×2 → 200',
    ]);
    assert.equal(
      formatTriggeredRequestLines([at('http://h/e'), at('http://g/e'), at('http://h:81/e')]).length,
      3
    );
  });

  void it('ignores a fragment, and groups URLs without a host by their text', () => {
    const at = (url: string): TriggeredRequest => ({
      requestId: url,
      method: 'GET',
      url,
      resourceType: 'Fetch',
      status: 200,
    });
    assert.deepEqual(formatTriggeredRequestLines([at('http://h/e#a'), at('http://h/e#b')]), [
      'GET h/e ×2 → 200',
    ]);
    assert.deepEqual(
      formatTriggeredRequestLines([at('data:text/plain,a'), at('data:text/plain,a')]),
      ['GET data:text/plain,a ×2 → 200']
    );
  });

  void it('keeps the loading signal of streaming requests in a group', () => {
    assert.deepEqual(formatTriggeredRequestLines(beacons(3, { loading: true, status: 200 })), [
      'POST 127.0.0.1:8080/event ×3 → 200 (loading)',
    ]);
    assert.deepEqual(
      formatTriggeredRequestLines([
        beacon(0, { status: 200 }),
        beacon(1, { status: 200, loading: true }),
      ]),
      ['POST 127.0.0.1:8080/event → 200 ×1, 200 (loading) ×1']
    );
  });

  void it('shows a group whose requests are all pending', () => {
    const pending = (i: number): TriggeredRequest =>
      triggered(`event?s=${i}`, { method: 'POST', resourceType: 'Other', pending: true });
    assert.deepEqual(formatTriggeredRequestLines([pending(0), pending(1), pending(2)]), [
      'POST 127.0.0.1:8080/event ×3 → pending',
    ]);
  });
});
