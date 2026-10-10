/**
 * Network list rows: URL display, the START and TIME columns.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NetworkRequest } from '@/types.js';
import {
  formatNetworkFollowRows,
  formatNetworkList,
  formatStartOffset,
  pageStartOf,
} from '@/ui/formatters/networkList.js';
import { truncateUrl } from '@/ui/formatting.js';

void describe('truncateUrl', () => {
  void it('keeps the port and the query string', () => {
    assert.equal(
      truncateUrl('http://127.0.0.1:47802/api/json?x=1', 50),
      '127.0.0.1:47802/api/json?x=1'
    );
    assert.equal(truncateUrl('https://www.example.com/', 50), 'www.example.com');
  });

  void it('cuts a long URL in the middle, keeping the host, the start and the end', () => {
    const cut = truncateUrl(`https://example.com/search?q=1&token=${'x'.repeat(80)}`, 50);
    assert.equal(cut.length, 50);
    assert.match(cut, /^example\.com\/search\?q=1&t…x+$/);
  });

  void it('keeps the end of the path and query, where similar requests differ', () => {
    const base = `https://api.example.com/v1/${'segment/'.repeat(8)}`;
    const first = truncateUrl(`${base}users/17/orders?page=2`, 60);
    const second = truncateUrl(`${base}users/17/orders?page=3`, 60);
    assert.equal(first.length, 60);
    assert.match(first, /^api\.example\.com\/v1\/seg.*….*users\/17\/orders\?page=2$/);
    assert.notEqual(first, second);
    assert.match(
      truncateUrl(`https://example.com/a/${'p'.repeat(80)}/x.js?q=1`, 50),
      /\/x\.js\?q=1$/
    );
  });

  void it('cuts a long host in the middle too', () => {
    const cut = truncateUrl(`https://${'h'.repeat(60)}.example.com/x`, 30);
    assert.equal(cut.length, 30);
    assert.match(cut, /^h+…h*\.example\.com\/x$/);
  });

  void it('shows non-web URLs as they are', () => {
    assert.equal(truncateUrl('data:text/plain,hello', 50), 'data:text/plain,hello');
    assert.equal(
      truncateUrl('blob:http://example.com/0b6e8d', 50),
      'blob:http://example.com/0b6e8d'
    );
  });
});

void describe('formatNetworkList', () => {
  void it('shows how long each request took', () => {
    const requests: NetworkRequest[] = [
      {
        requestId: '1',
        url: 'https://a.test/fast',
        method: 'GET',
        timestamp: 0,
        status: 200,
        duration: 85,
      },
      {
        requestId: '2',
        url: 'https://a.test/slow',
        method: 'GET',
        timestamp: 0,
        status: 200,
        duration: 1234,
      },
      { requestId: '3', url: 'https://a.test/open', method: 'GET', timestamp: 0 },
    ];

    const output = formatNetworkList(requests, {});

    assert.match(output, /TIME/);
    assert.match(output, /\s85ms\s+a\.test\/fast/);
    assert.match(output, /\s1\.2s\s+a\.test\/slow/);
    assert.match(output, /\s-\s+a\.test\/open/);
  });

  void it('says how many requests matched the filters', () => {
    const request: NetworkRequest = {
      requestId: '1',
      url: 'https://a.test/',
      method: 'GET',
      timestamp: 0,
    };
    const header = (filteredCount: number, totalCount: number): string | undefined =>
      formatNetworkList([request], { filteredCount, totalCount }).split('\n')[0];

    assert.equal(header(1, 1), 'NETWORK REQUESTS (1)');
    assert.equal(header(5, 5), 'NETWORK REQUESTS (last 1 of 5)');
    assert.equal(header(1, 240), 'NETWORK REQUESTS (1 matching, 240 in all)');
    assert.equal(header(21, 240), 'NETWORK REQUESTS (last 1 of 21 matching, 240 in all)');
  });
});

void describe('START column', () => {
  const request = (overrides: Partial<NetworkRequest>): NetworkRequest => ({
    requestId: overrides.requestId ?? 'r',
    url: 'https://a.test/',
    method: 'GET',
    timestamp: 0,
    ...overrides,
  });

  void it('counts from the document request of the latest navigation', () => {
    const requests = [
      request({
        requestId: 'old',
        resourceType: 'Document',
        navigationId: 1,
        timestamp: 1000,
        sentTime: 10,
      }),
      request({
        requestId: 'img',
        resourceType: 'Image',
        navigationId: 2,
        timestamp: 4900,
        sentTime: 13.9,
      }),
      request({
        requestId: 'doc',
        resourceType: 'Document',
        navigationId: 2,
        timestamp: 5000,
        sentTime: 14,
      }),
      request({
        requestId: 'frame',
        resourceType: 'Document',
        navigationId: 2,
        timestamp: 6000,
        sentTime: 15,
      }),
    ];
    assert.deepEqual(pageStartOf(requests), { timestamp: 5000, sentTime: 14 });
    assert.equal(pageStartOf([]), undefined);
  });

  void it("falls back to the page's earliest request without a captured document", () => {
    const requests = [
      request({ requestId: 'b', navigationId: 3, timestamp: 2000 }),
      request({ requestId: 'a', navigationId: 3, timestamp: 1500 }),
    ];
    assert.deepEqual(pageStartOf(requests), { timestamp: 1500 });
  });

  void it("formats the offset compactly, in Chrome's time when both have it", () => {
    const start = { timestamp: 10_000, sentTime: 100 };
    const at = (sentTime: number): string => formatStartOffset(request({ sentTime }), start);
    assert.equal(at(100), '+0.0s');
    assert.equal(at(101.234), '+1.2s');
    assert.equal(at(199.9), '+99.9s');
    assert.equal(at(350), '+250s');
    assert.equal(at(100 + 3600), '+60m');
    assert.equal(at(64.8), '-35.2s');
    assert.equal(formatStartOffset(request({ timestamp: 12_500 }), start), '+2.5s');
    assert.equal(formatStartOffset(request({}), undefined), '-');
  });

  void it('adds the column to each row, aligned with long methods', () => {
    const requests = [
      request({ requestId: '1', timestamp: 1000, status: 200, duration: 5 }),
      request({ requestId: '2', method: 'OPTIONS', timestamp: 2200, status: 204, duration: 5 }),
    ];
    const lines = formatNetworkList(requests, { pageStart: { timestamp: 1000 } }).split('\n');
    const header = lines.find((l) => l.includes('START')) ?? '';
    const rows = lines.filter((l) => l.startsWith('[1]') || l.startsWith('[2]'));
    assert.match(header, /^\[ID\]\s+START STS METH\s+TYP/);
    assert.match(rows[0] ?? '', /^\[1\]\s+\+0\.0s 200 GET {5}/);
    assert.match(rows[1] ?? '', /^\[2\]\s+\+1\.2s 204 OPTIONS /);
    const urlColumn = (line: string): number => line.indexOf('a.test');
    assert.equal(urlColumn(rows[0] ?? ''), urlColumn(rows[1] ?? ''));
    assert.equal(header.indexOf('URL'), urlColumn(rows[0] ?? ''));
  });
});

void describe('formatNetworkList eviction note', () => {
  void it('says how many older requests the session dropped, and nothing when none were', () => {
    const evictions = { requestsDropped: 1, bodiesEvicted: 0 };
    assert.match(
      formatNetworkList([], { evictions }),
      /⚠ 1 older network request was dropped: bdg keeps the newest 10000/
    );
    const bodies = { requestsDropped: 0, bodiesEvicted: 5 };
    assert.match(
      formatNetworkList([], { evictions: bodies }),
      /⚠ 5 older request\/response bodies were evicted: bdg keeps the newest 100 MB of bodies/
    );
    assert.doesNotMatch(
      formatNetworkList([], { evictions: { requestsDropped: 0, bodiesEvicted: 0 } }),
      /⚠/
    );
  });
});

void describe('formatNetworkFollowRows eviction note', () => {
  void it('prints the note when given counts, and nothing extra otherwise', () => {
    const evictions = { requestsDropped: 7, bodiesEvicted: 0 };
    assert.equal(
      formatNetworkFollowRows([], { evictions }),
      '⚠ 7 older network requests were dropped: bdg keeps the newest 10000'
    );
    assert.equal(formatNetworkFollowRows([]), '');
  });
});

void describe('blocked cookie mark', () => {
  const blocked: NetworkRequest = {
    requestId: '1.2',
    url: 'http://localhost:8802/api',
    method: 'GET',
    timestamp: 0,
    status: 200,
    blockedCookies: [{ name: 'tp_lax', kind: 'not-sent', reasons: ['SchemefulSameSiteLax'] }],
  };
  const clean: NetworkRequest = { ...blocked, requestId: '1.3', blockedCookies: [] };

  void it('marks rows of requests with blocked cookies, in the list and the stream', () => {
    const rows = formatNetworkList([blocked, clean], {}).split('\n');
    assert.match(
      rows.find((row) => row.startsWith('[1.2]')) ?? '',
      /localhost:8802\/api {2}⚠ cookie blocked$/
    );
    assert.doesNotMatch(rows.find((row) => row.startsWith('[1.3]')) ?? '', /cookie blocked/);
    assert.match(formatNetworkFollowRows([blocked]), /⚠ cookie blocked$/m);
  });
});

void describe('blocked cookie mark on list previews', () => {
  void it('marks a row from its summary', () => {
    const preview: NetworkRequest = {
      requestId: '2.1',
      url: 'http://localhost:8802/api',
      method: 'GET',
      timestamp: 0,
      status: 200,
      blockedCookieSummary: {
        count: 1,
        kinds: ['not-sent'],
        reasons: ['SameSiteLax'],
        names: ['a'],
      },
    };
    assert.match(formatNetworkList([preview], {}), /⚠ cookie blocked$/m);
  });
});

void describe('formatNetworkList --page and --sort', () => {
  const request: NetworkRequest = {
    requestId: '1',
    url: 'https://a.test/',
    method: 'GET',
    timestamp: 0,
  };

  void it('ends with how many requests of earlier pages were hidden', () => {
    const output = formatNetworkList([request], { hiddenEarlierPages: 3 });
    assert.equal(output.split('\n').at(-1), '3 requests from earlier pages hidden (--page all)');
    assert.match(
      formatNetworkList([], { hiddenEarlierPages: 1 }),
      /No matching requests found\.\n1 request from earlier pages hidden \(--page all\)$/
    );
    assert.doesNotMatch(formatNetworkList([request], { hiddenEarlierPages: 0 }), /hidden/);
  });

  void it('says the order and the window of a sorted list', () => {
    const header = (options: Parameters<typeof formatNetworkList>[1]): string | undefined =>
      formatNetworkList([request], options).split('\n')[0];
    assert.equal(
      header({ sort: 'size', filteredCount: 5, totalCount: 5 }),
      'NETWORK REQUESTS (1 largest of 5)'
    );
    assert.equal(
      header({ sort: 'duration', filteredCount: 21, totalCount: 240 }),
      'NETWORK REQUESTS (1 slowest of 21 matching, 240 in all)'
    );
    assert.equal(
      header({ sort: 'size', filteredCount: 1, totalCount: 1 }),
      'NETWORK REQUESTS (1, largest first)'
    );
    assert.equal(
      header({ sort: 'start', filteredCount: 5, totalCount: 5 }),
      'NETWORK REQUESTS (last 1 of 5)'
    );
  });
});
