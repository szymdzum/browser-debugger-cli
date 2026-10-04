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
    assert.equal(truncateUrl('https://www.example.com/', 50), 'example.com');
  });

  void it('elides a long query before the path', () => {
    assert.equal(
      truncateUrl(`https://example.com/search?q=${'x'.repeat(80)}`, 50),
      'example.com/search?…'
    );
  });

  void it('marks an elided query also when the path is shortened', () => {
    assert.match(truncateUrl(`https://example.com/${'p'.repeat(80)}?q=1`, 50), /\?…$/);
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
});
