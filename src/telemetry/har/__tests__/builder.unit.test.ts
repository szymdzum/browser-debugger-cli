/**
 * HAR Builder Unit Tests
 *
 * Tests the contract of buildHAR function - transforming NetworkRequest[] to HAR 1.2 format.
 * Following TESTING_PHILOSOPHY.md: Test the contract, not the implementation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { HARMetadata } from '@/telemetry/har/builder.js';
import { buildHAR } from '@/telemetry/har/builder.js';
import type { Entry, Timings } from '@/telemetry/har/types.js';
import { RequestRetention } from '@/telemetry/networkRetention.js';
import type { NetworkRequest } from '@/types.js';

describe('HAR Builder', () => {
  const baseMetadata: HARMetadata = {
    version: '0.7.0',
    chromeVersion: '131.0.0.0',
  };

  /**
   * Helper to get first entry with TypeScript assertion.
   */
  function getFirstEntry(entries: Entry[]): Entry {
    const entry = entries[0];
    assert.ok(entry, 'Entry should exist');
    return entry;
  }

  /**
   * Calculate total time from timings (same logic as builder).
   */
  function calculateExpectedTotalTime(timings: Timings): number {
    const phases = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const;
    return phases.reduce((total, phase) => {
      const time = timings[phase];
      return total + (time !== undefined && time >= 0 ? time : 0);
    }, 0);
  }

  describe('Basic structure', () => {
    test('creates valid HAR 1.2 structure', () => {
      const requests: NetworkRequest[] = [];
      const har = buildHAR(requests, baseMetadata);

      assert.equal(har.log.version, '1.2');
      assert.equal(har.log.creator.name, 'bdg');
      assert.equal(har.log.creator.version, '0.7.0');
      assert.ok(Array.isArray(har.log.entries));
    });

    test('includes browser info when chromeVersion provided', () => {
      const har = buildHAR([], baseMetadata);

      assert.ok(har.log.browser);
      assert.equal(har.log.browser.name, 'Chrome');
      assert.equal(har.log.browser.version, '131.0.0.0');
    });

    test('omits browser info when chromeVersion not provided', () => {
      const har = buildHAR([], { version: '0.7.0' });

      assert.equal(har.log.browser, undefined);
    });
  });

  describe('Request transformation', () => {
    test('transforms basic GET request', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/api',
          method: 'GET',
          timestamp: Date.now(),
        },
      ];

      const har = buildHAR(requests, baseMetadata);

      assert.equal(har.log.entries.length, 1);
      const entry = getFirstEntry(har.log.entries);
      assert.equal(entry.request.method, 'GET');
      assert.equal(entry.request.url, 'https://example.com/api');
      assert.equal(entry.request.httpVersion, 'HTTP/1.1');
    });

    test('includes request headers', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          requestHeaders: {
            'user-agent': 'test-agent',
            accept: 'application/json',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const headers = getFirstEntry(har.log.entries).request.headers;

      assert.equal(headers.length, 2);
      assert.ok(headers.some((h) => h.name === 'user-agent' && h.value === 'test-agent'));
      assert.ok(headers.some((h) => h.name === 'accept' && h.value === 'application/json'));
    });

    test('extracts query parameters from URL', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/api?foo=bar&baz=qux',
          method: 'GET',
          timestamp: Date.now(),
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const query = getFirstEntry(har.log.entries).request.queryString;

      assert.equal(query.length, 2);
      assert.ok(query.some((q) => q.name === 'foo' && q.value === 'bar'));
      assert.ok(query.some((q) => q.name === 'baz' && q.value === 'qux'));
    });

    test('includes POST body', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/api',
          method: 'POST',
          timestamp: Date.now(),
          requestBody: '{"key":"value"}',
          requestHeaders: {
            'content-type': 'application/json',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const postData = getFirstEntry(har.log.entries).request.postData;

      assert.ok(postData);
      assert.equal(postData.mimeType, 'application/json');
      assert.equal(postData.text, '{"key":"value"}');
    });

    test('calculates request headers size including HTTP line', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/path',
          method: 'GET',
          timestamp: Date.now(),
          requestHeaders: {
            host: 'example.com',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const headersSize = getFirstEntry(har.log.entries).request.headersSize;

      // Should include "GET /path HTTP/1.1\r\n" + "host: example.com\r\n" + "\r\n"
      assert.ok(headersSize > 0);
      assert.ok(headersSize > 'host: example.com'.length); // More than just header
    });
  });

  describe('Response transformation', () => {
    test('includes response status and headers', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          mimeType: 'text/html',
          responseHeaders: {
            'content-type': 'text/html; charset=utf-8',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const response = getFirstEntry(har.log.entries).response;

      assert.equal(response.status, 200);
      assert.equal(response.statusText, 'OK');
      assert.equal(response.httpVersion, 'HTTP/1.1');
      assert.ok(response.headers.some((h) => h.name === 'content-type'));
    });

    test('includes response body', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          mimeType: 'application/json',
          responseBody: '{"result":"ok"}',
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const content = getFirstEntry(har.log.entries).response.content;

      assert.equal(content.mimeType, 'application/json');
      assert.equal(content.text, '{"result":"ok"}');
      assert.ok(content.size > 0);
    });

    test('base64 encodes binary content', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/image.png',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          mimeType: 'image/png',
          responseBody: Buffer.from('binary-data').toString('base64'),
          responseBodyBase64: true,
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const content = getFirstEntry(har.log.entries).response.content;

      assert.equal(content.mimeType, 'image/png');
      assert.equal(content.encoding, 'base64');
      assert.equal(content.text, Buffer.from('binary-data').toString('base64'));
    });

    test('uses encodedDataLength for response bodySize', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          responseBody: 'test',
          encodedDataLength: 1234, // Wire size (compressed)
          decodedBodyLength: 5678, // Decoded size
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const response = getFirstEntry(har.log.entries).response;

      assert.equal(response.bodySize, 1234); // Should use wire size
      assert.equal(response.content.size, 5678); // Should use decoded size
    });

    test('calculates response headers size including status line', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          responseHeaders: {
            'content-type': 'text/html',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const headersSize = getFirstEntry(har.log.entries).response.headersSize;

      // Should include "HTTP/1.1 200 OK\r\n" + headers + "\r\n"
      assert.ok(headersSize > 0);
      assert.ok(headersSize > 'content-type: text/html'.length);
    });
  });

  describe('Timing calculations', () => {
    test('uses real timing data when available', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          timing: {
            requestTime: 1000.0,
            dnsStart: 0,
            dnsEnd: 50,
            connectStart: 50,
            connectEnd: 150,
            sslStart: 75,
            sslEnd: 125,
            sendStart: 150,
            sendEnd: 155,
            receiveHeadersEnd: 200,
          },
          loadingFinishedTime: 1000.25, // 250ms after requestTime
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const timings = getFirstEntry(har.log.entries).timings;

      assert.equal(timings.dns, 50); // dnsEnd - dnsStart
      assert.equal(timings.connect, 100); // connectEnd - connectStart
      assert.equal(timings.ssl, 50); // sslEnd - sslStart
      assert.equal(timings.send, 5); // sendEnd - sendStart
      assert.equal(timings.wait, 45); // receiveHeadersEnd - sendEnd
      assert.equal(timings.receive, 50); // (loadingFinishedTime - requestTime)*1000 - receiveHeadersEnd
    });

    test('uses -1 for unknown timing fields', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          timing: {
            requestTime: 1000.0,
            dnsStart: -1,
            dnsEnd: -1,
            connectStart: -1,
            connectEnd: -1,
            sendStart: 150,
            sendEnd: 155,
            receiveHeadersEnd: 200,
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const timings = getFirstEntry(har.log.entries).timings;

      assert.equal(timings.dns, -1);
      assert.equal(timings.connect, -1);
      assert.equal(timings.send, 5); // Still calculates known values
    });

    test('calculates total time from timing breakdown', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          timing: {
            requestTime: 1000.0,
            dnsStart: 0,
            dnsEnd: 50,
            connectStart: 50,
            connectEnd: 150,
            sendStart: 150,
            sendEnd: 155,
            receiveHeadersEnd: 200,
          },
          loadingFinishedTime: 1000.25,
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const { timings, time } = getFirstEntry(har.log.entries);

      // time should be sum of all phases (except ssl which overlaps)
      assert.equal(time, calculateExpectedTotalTime(timings));
    });

    test('handles missing timing data gracefully', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          // No timing data
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const { timings, time } = getFirstEntry(har.log.entries);

      assert.equal(timings.blocked, -1);
      assert.equal(timings.dns, -1);
      assert.equal(timings.connect, -1);
      // HAR 1.2: send/wait/receive must be non-negative
      assert.equal(timings.send, 0);
      assert.equal(timings.wait, 0);
      assert.equal(timings.receive, 0);
      assert.equal(time, 0); // No timing data = 0 total
    });
  });

  describe('Server metadata', () => {
    test('includes server IP and connection ID when available', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          serverIPAddress: '192.168.1.1',
          connection: '42',
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const entry = getFirstEntry(har.log.entries);

      assert.equal(entry.serverIPAddress, '192.168.1.1');
      assert.equal(entry.connection, '42');
    });

    test('omits server metadata when not available', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const entry = getFirstEntry(har.log.entries);

      assert.equal(entry.serverIPAddress, undefined);
      assert.equal(entry.connection, undefined);
    });
  });

  describe('Edge cases', () => {
    test('handles empty request array', () => {
      const har = buildHAR([], baseMetadata);

      assert.equal(har.log.entries.length, 0);
    });

    test('handles request with no headers', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const { request, response } = getFirstEntry(har.log.entries);

      assert.equal(request.headers.length, 0);
      assert.equal(response.headers.length, 0);
    });

    test('handles failed request (status 0)', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          status: 0,
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const response = getFirstEntry(har.log.entries).response;

      assert.equal(response.status, 0);
      assert.equal(response.statusText, '');
    });

    test('handles URL with special characters', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/path?query=hello%20world&foo=bar%26baz',
          method: 'GET',
          timestamp: Date.now(),
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const entry = getFirstEntry(har.log.entries);

      assert.equal(entry.request.url, 'https://example.com/path?query=hello%20world&foo=bar%26baz');
      assert.ok(entry.request.queryString.length > 0);
    });
  });

  describe('Cookie handling', () => {
    test('extracts cookies from request headers', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          requestHeaders: {
            cookie: 'session=abc123; theme=dark',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata, { includeSensitive: true });
      const cookies = getFirstEntry(har.log.entries).request.cookies;

      assert.equal(cookies.length, 2);
      assert.ok(cookies.some((c) => c.name === 'session' && c.value === 'abc123'));
      assert.ok(cookies.some((c) => c.name === 'theme' && c.value === 'dark'));
    });

    test('extracts cookies from set-cookie header', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          responseHeaders: {
            'set-cookie': 'session=xyz789; path=/; secure',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const cookies = getFirstEntry(har.log.entries).response.cookies;

      assert.ok(cookies.length > 0);
      assert.ok(cookies.some((c) => c.name === 'session'));
    });
  });

  describe('Receive time edge cases', () => {
    test('handles loadingFinishedTime before receiveHeadersEnd (invalid data)', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          timing: {
            requestTime: 1000.0,
            receiveHeadersEnd: 200,
            sendEnd: 150,
            sendStart: 140,
            sslEnd: 130,
            sslStart: 100,
            connectEnd: 100,
            connectStart: 50,
            dnsEnd: 50,
            dnsStart: 0,
          },
          loadingFinishedTime: 999.9, // Before requestTime (impossible but test robustness)
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const timings = getFirstEntry(har.log.entries).timings;

      // HAR 1.2 requires receive >= 0; inconsistent CDP data is clamped to 0
      assert.equal(timings.receive, 0);
    });

    test('handles large file download (significant receive time)', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/large-file.zip',
          method: 'GET',
          timestamp: Date.now(),
          timing: {
            requestTime: 1000.0,
            receiveHeadersEnd: 200,
            sendEnd: 150,
            sendStart: 140,
            sslEnd: 130,
            sslStart: 100,
            connectEnd: 100,
            connectStart: 50,
            dnsEnd: 50,
            dnsStart: 0,
          },
          loadingFinishedTime: 1005.5, // 5.5 seconds after requestTime
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const timings = getFirstEntry(har.log.entries).timings;

      // receive = (1005.5 - 1000.0) * 1000 - 200 = 5500 - 200 = 5300ms
      assert.equal(timings.receive, 5300);
    });

    test('handles missing loadingFinishedTime gracefully', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          timing: {
            requestTime: 1000.0,
            receiveHeadersEnd: 200,
            sendEnd: 150,
            sendStart: 140,
            sslEnd: 130,
            sslStart: 100,
            connectEnd: 100,
            connectStart: 50,
            dnsEnd: 50,
            dnsStart: 0,
          },
          // No loadingFinishedTime
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const timings = getFirstEntry(har.log.entries).timings;

      assert.equal(timings.receive, 0); // Unknown -> 0 (HAR 1.2 requires receive >= 0)
    });
  });

  describe('Binary content encoding validation', () => {
    test('keeps base64 bodies from Chrome as they are (no double encoding)', () => {
      const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/image.png',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          mimeType: 'image/png',
          responseBody: base64,
          responseBodyBase64: true,
        },
      ];

      const content = getFirstEntry(buildHAR(requests, baseMetadata).log.entries).response.content;

      assert.equal(content.encoding, 'base64');
      assert.equal(content.text, base64);
    });

    test('uses the full status text table, the server text first, and _error for failures', () => {
      const entry = (
        overrides: Partial<NetworkRequest>
      ): ReturnType<typeof getFirstEntry>['response'] =>
        getFirstEntry(
          buildHAR(
            [
              {
                requestId: 'r',
                url: 'https://example.com',
                method: 'GET',
                timestamp: 1,
                ...overrides,
              },
            ],
            baseMetadata
          ).log.entries
        ).response;

      assert.equal(entry({ status: 307 }).statusText, 'Temporary Redirect');
      assert.equal(entry({ status: 418 }).statusText, "I'm a Teapot");
      assert.equal(entry({ status: 200, statusText: 'Fine' }).statusText, 'Fine');
      assert.equal(
        entry({ status: 0, errorText: 'net::ERR_NAME_NOT_RESOLVED' })._error,
        'net::ERR_NAME_NOT_RESOLVED'
      );
    });

    test('orders entries by start time', () => {
      const requests: NetworkRequest[] = [
        { requestId: 'late', url: 'https://example.com/b', method: 'GET', timestamp: 2000 },
        { requestId: 'early', url: 'https://example.com/a', method: 'GET', timestamp: 1000 },
      ];
      const urls = buildHAR(requests, baseMetadata).log.entries.map((e) => e.request.url);
      assert.deepEqual(urls, ['https://example.com/a', 'https://example.com/b']);
    });

    test('does not encode text content', () => {
      const textTypes = ['text/html', 'text/plain', 'application/json', 'application/javascript'];

      for (const mimeType of textTypes) {
        const requests: NetworkRequest[] = [
          {
            requestId: 'req-1',
            url: 'https://example.com/file',
            method: 'GET',
            timestamp: Date.now(),
            status: 200,
            mimeType,
            responseBody: '{"test":"data"}',
          },
        ];

        const har = buildHAR(requests, baseMetadata);
        const content = getFirstEntry(har.log.entries).response.content;

        assert.equal(content.encoding, undefined, `Should not encode ${mimeType}`);
        assert.equal(content.text, '{"test":"data"}');
      }
    });
  });

  describe('Complex header parsing', () => {
    test('handles headers with special characters', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          requestHeaders: {
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)',
            'accept-language': 'en-US,en;q=0.9',
            'x-custom': 'value=with=equals',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const headers = getFirstEntry(har.log.entries).request.headers;

      assert.ok(headers.some((h) => h.name === 'user-agent' && h.value.includes('X11')));
      assert.ok(headers.some((h) => h.name === 'accept-language' && h.value.includes('q=0.9')));
      assert.ok(headers.some((h) => h.name === 'x-custom' && h.value === 'value=with=equals'));
    });

    test('handles empty header values', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          requestHeaders: {
            'empty-header': '',
            'normal-header': 'value',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const headers = getFirstEntry(har.log.entries).request.headers;

      assert.ok(headers.some((h) => h.name === 'empty-header' && h.value === ''));
      assert.ok(headers.some((h) => h.name === 'normal-header' && h.value === 'value'));
    });

    test('calculates header size for complex headers', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/path?query=value',
          method: 'POST',
          timestamp: Date.now(),
          requestHeaders: {
            'content-type': 'application/json; charset=utf-8',
            authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
            'x-request-id': '550e8400-e29b-41d4-a716-446655440000',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const headersSize = getFirstEntry(har.log.entries).request.headersSize;

      // Should include: "POST /path?query=value HTTP/1.1\r\n" + all headers + "\r\n"
      const expectedMinSize =
        'POST /path?query=value HTTP/1.1\r\n'.length +
        'content-type: application/json; charset=utf-8\r\n'.length +
        'authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\r\n'.length +
        'x-request-id: 550e8400-e29b-41d4-a716-446655440000\r\n'.length +
        '\r\n'.length;

      assert.ok(
        headersSize >= expectedMinSize,
        `Headers size ${headersSize} should be >= ${expectedMinSize}`
      );
    });

    test('handles cookie headers with special characters', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com',
          method: 'GET',
          timestamp: Date.now(),
          requestHeaders: {
            cookie: 'token=abc%3D%3D123; path=/admin; expires=Wed, 21 Oct 2025 07:28:00 GMT',
          },
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const cookies = getFirstEntry(har.log.entries).request.cookies;

      // Should parse cookie name/value pairs (ignoring attributes like path, expires)
      assert.ok(cookies.length >= 1);
      assert.ok(cookies.some((c) => c.name === 'token'));
    });
  });
});

describe('HAR fidelity (HTTP/1.1 headers, cookies, redirects, skipped bodies)', () => {
  const metadata: HARMetadata = { version: '0.0.0-test' };

  /**
   * Build a one-entry HAR, credentials kept as captured, and return its entry.
   *
   * @param req - Request fields
   * @returns HAR entry
   */
  function entryFor(req: Partial<NetworkRequest>): Entry {
    const har = buildHAR(
      [{ requestId: 'r', url: 'https://example.com/a', method: 'GET', timestamp: 0, ...req }],
      metadata,
      { includeSensitive: true }
    );
    const entry = har.log.entries[0];
    assert.ok(entry);
    return entry;
  }

  test('reads HTTP/1.1 (capitalized) headers', () => {
    const entry = entryFor({
      method: 'POST',
      requestBody: '{"a":1}',
      requestHeaders: { 'Content-Type': 'application/json', Cookie: 'sid=1' },
      status: 302,
      responseHeaders: { Location: 'https://example.com/b' },
    });
    assert.equal(entry.request.postData?.mimeType, 'application/json');
    assert.deepEqual(entry.request.cookies, [{ name: 'sid', value: '1' }]);
    assert.equal(entry.response.redirectURL, 'https://example.com/b');
  });

  test('treats Set-Cookie attributes as attributes, one cookie per line', () => {
    const entry = entryFor({
      responseHeaders: {
        'Set-Cookie':
          'sid=abc; Path=/; HttpOnly; Secure; Expires=Wed, 21 Oct 2026 07:28:00 GMT\ntheme=dark; Domain=example.com',
      },
    });
    assert.deepEqual(
      entry.response.cookies.map((c) => c.name),
      ['sid', 'theme']
    );
    const [sid, theme] = entry.response.cookies;
    assert.equal(sid?.path, '/');
    assert.equal(sid?.httpOnly, true);
    assert.equal(sid?.secure, true);
    assert.equal(sid?.expires, '2026-10-21T07:28:00.000Z');
    assert.equal(theme?.domain, 'example.com');
  });

  test('uses the recorded redirect target of a redirect hop', () => {
    const entry = entryFor({ status: 301, redirectURL: 'https://example.com/final' });
    assert.equal(entry.response.redirectURL, 'https://example.com/final');
  });

  test('exports a skipped body as a comment, not as content text', () => {
    const entry = entryFor({ mimeType: 'image/png', responseBody: '[SKIPPED: non-text]' });
    assert.equal(entry.response.content.text, undefined);
    assert.equal(entry.response.content.encoding, undefined);
    assert.match(entry.response.content.comment ?? '', /non-text/);
  });

  test('exports a body evicted at the body budget with its original size and why', () => {
    const request: NetworkRequest = {
      requestId: 'r',
      url: 'https://example.com/a',
      method: 'GET',
      timestamp: 0,
      mimeType: 'application/json',
    };
    const evictions = { requestsDropped: 0, bodiesEvicted: 0 };
    const retention = new RequestRetention(
      [],
      { maxRequests: 10, maxTotalBodyBytes: 4 },
      evictions
    );
    retention.storeBody(request, '{"big":true}', false);
    assert.equal(evictions.bodiesEvicted, 1);

    const entry = entryFor(request);
    assert.equal(entry.response.content.size, 12);
    assert.equal(entry.response.content.text, undefined);
    assert.match(
      entry.response.content.comment ?? '',
      /^Body not captured: evicted: total body budget/
    );
  });

  test('postData carries text only (params and text are mutually exclusive)', () => {
    const entry = entryFor({ method: 'POST', requestBody: 'a=1' });
    assert.equal(entry.request.postData?.text, 'a=1');
    assert.equal(entry.request.postData?.params, undefined);
  });

  describe('Responses from the browser cache', () => {
    test('use the measured duration, not the original request timing', () => {
      const har = buildHAR(
        [
          {
            requestId: 'c',
            url: 'https://example.com/logo.svg',
            method: 'GET',
            timestamp: 1000,
            status: 200,
            fromCache: true,
            duration: 3,
            loadingFinishedTime: 500,
            timing: { requestTime: 10, receiveHeadersEnd: 5 },
          },
        ],
        metadata
      );

      const [entry] = har.log.entries;
      assert.equal(entry?.time, 3);
      assert.equal(entry?.timings.receive, 3);
    });
  });

  describe('WebSocket connections', () => {
    test('exports messages in the Chrome DevTools convention', () => {
      const har = buildHAR(
        [
          {
            requestId: 'W',
            url: 'ws://example.com/ws',
            method: 'GET',
            timestamp: 1000,
            status: 101,
            resourceType: 'WebSocket',
            webSocket: {
              frames: [
                { timestamp: 2000, direction: 'sent', opcode: 1, payloadData: 'hi' },
                { timestamp: 2500, direction: 'received', opcode: 2, payloadData: 'AQID' },
              ],
            },
          },
        ],
        metadata
      );

      const [entry] = har.log.entries;
      assert.equal(entry?._resourceType, 'WebSocket');
      assert.equal(entry?.response.status, 101);
      assert.deepEqual(entry?._webSocketMessages, [
        { type: 'send', time: 2, opcode: 1, data: 'hi' },
        { type: 'receive', time: 2.5, opcode: 2, data: 'AQID' },
      ]);
    });
  });
});
