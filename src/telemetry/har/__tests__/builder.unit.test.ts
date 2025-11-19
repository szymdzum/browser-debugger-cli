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
          responseBody: 'binary-data',
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const content = getFirstEntry(har.log.entries).response.content;

      assert.equal(content.mimeType, 'image/png');
      assert.equal(content.encoding, 'base64');
      assert.ok(content.text); // Should be base64 encoded
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
      assert.equal(timings.send, -1);
      assert.equal(timings.wait, -1);
      assert.equal(timings.receive, -1);
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
      assert.equal(response.statusText, 'Unknown');
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

      const har = buildHAR(requests, baseMetadata);
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

      // Should produce negative receive time, which is valid per HAR spec for unknown/invalid
      // receive = (999.9 - 1000.0) * 1000 - 200 = -100 - 200 = -300
      // Use approximate comparison for floating point
      assert.ok(Math.abs(timings.receive - -300) < 0.001, `Expected -300, got ${timings.receive}`);
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

      assert.equal(timings.receive, -1); // Unknown
    });
  });

  describe('Binary content encoding validation', () => {
    test('base64 encodes binary content correctly', () => {
      const binaryData = 'test-binary-data';
      const expectedBase64 = Buffer.from(binaryData).toString('base64');

      const requests: NetworkRequest[] = [
        {
          requestId: 'req-1',
          url: 'https://example.com/image.png',
          method: 'GET',
          timestamp: Date.now(),
          status: 200,
          mimeType: 'image/png',
          responseBody: binaryData,
        },
      ];

      const har = buildHAR(requests, baseMetadata);
      const content = getFirstEntry(har.log.entries).response.content;

      assert.equal(content.encoding, 'base64');
      assert.equal(content.text, expectedBase64);
    });

    test('detects various binary MIME types', () => {
      const binaryTypes = [
        'image/jpeg',
        'image/gif',
        'video/mp4',
        'audio/mpeg',
        'application/pdf',
        'application/zip',
      ];

      for (const mimeType of binaryTypes) {
        const requests: NetworkRequest[] = [
          {
            requestId: 'req-1',
            url: 'https://example.com/file',
            method: 'GET',
            timestamp: Date.now(),
            status: 200,
            mimeType,
            responseBody: 'data',
          },
        ];

        const har = buildHAR(requests, baseMetadata);
        const content = getFirstEntry(har.log.entries).response.content;

        assert.equal(content.encoding, 'base64', `Should base64 encode ${mimeType}`);
        assert.equal(content.text, Buffer.from('data').toString('base64'));
      }
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
