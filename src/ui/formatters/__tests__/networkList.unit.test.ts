/**
 * Network list rows: URL display and the TIME column.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NetworkRequest } from '@/types.js';
import { formatNetworkList } from '@/ui/formatters/networkList.js';
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
