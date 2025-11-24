/**
 * Filter DSL unit tests.
 *
 * Tests the contract of the filter DSL parser and evaluator:
 * - Input parsing produces expected filter objects
 * - Filter application produces expected request subsets
 * - Validation returns helpful error messages
 *
 * Following test philosophy: Test behavior (input to output), not implementation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseFilterString,
  validateFilterString,
  applyFilters,
  parseSize,
  getFilterHelpText,
} from '@/telemetry/filterDsl.js';
import type { NetworkRequest } from '@/types.js';

/**
 * Create a minimal network request for testing.
 */
function createRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId: 'req-1',
    url: 'https://example.com/api/data',
    method: 'GET',
    timestamp: Date.now(),
    status: 200,
    mimeType: 'application/json',
    resourceType: 'XHR',
    encodedDataLength: 1024,
    responseHeaders: {},
    ...overrides,
  };
}

describe('Filter DSL parsing', () => {
  describe('parseFilterString', () => {
    it('parses simple filter', () => {
      const filters = parseFilterString('domain:example.com');

      assert.equal(filters.length, 1);
      assert.equal(filters[0]?.type, 'domain');
      assert.equal(filters[0]?.value, 'example.com');
      assert.equal(filters[0]?.negated, false);
      assert.equal(filters[0]?.operator, '=');
    });

    it('parses status-code with comparison operators', () => {
      const testCases: Array<{ input: string; operator: string; value: string }> = [
        { input: 'status-code:200', operator: '=', value: '200' },
        { input: 'status-code:>=400', operator: '>=', value: '400' },
        { input: 'status-code:<=299', operator: '<=', value: '299' },
        { input: 'status-code:>500', operator: '>', value: '500' },
        { input: 'status-code:<400', operator: '<', value: '400' },
      ];

      for (const { input, operator, value } of testCases) {
        const filters = parseFilterString(input);
        assert.equal(filters[0]?.operator, operator, `${input} should have operator ${operator}`);
        assert.equal(filters[0]?.value, value, `${input} should have value ${value}`);
      }
    });

    it('parses negation with - prefix', () => {
      const filters = parseFilterString('-domain:cdn.example.com');

      assert.equal(filters[0]?.negated, true);
      assert.equal(filters[0]?.type, 'domain');
      assert.equal(filters[0]?.value, 'cdn.example.com');
    });

    it('parses negation with ! prefix', () => {
      const filters = parseFilterString('!method:POST');

      assert.equal(filters[0]?.negated, true);
      assert.equal(filters[0]?.type, 'method');
      assert.equal(filters[0]?.value, 'POST');
    });

    it('parses multiple filters', () => {
      const filters = parseFilterString('domain:api.* status-code:>=400 method:POST');

      assert.equal(filters.length, 3);
      assert.equal(filters[0]?.type, 'domain');
      assert.equal(filters[1]?.type, 'status-code');
      assert.equal(filters[2]?.type, 'method');
    });

    it('parses quoted filters with spaces', () => {
      const filters = parseFilterString('"domain:example.com" "method:GET"');

      assert.equal(filters.length, 2);
      assert.equal(filters[0]?.value, 'example.com');
      assert.equal(filters[1]?.value, 'GET');
    });

    it('parses all supported filter types', () => {
      const types = [
        'domain:example.com',
        'status-code:200',
        'method:GET',
        'mime-type:application/json',
        'resource-type:XHR',
        'larger-than:1MB',
        'has-response-header:content-type',
        'is:from-cache',
        'scheme:https',
      ];

      for (const input of types) {
        const filters = parseFilterString(input);
        assert.equal(filters.length, 1, `Should parse: ${input}`);
      }
    });

    it('handles empty input', () => {
      assert.deepEqual(parseFilterString(''), []);
      assert.deepEqual(parseFilterString('   '), []);
    });

    it('normalizes is: filter values to lowercase', () => {
      const filters = parseFilterString('is:FROM-CACHE');
      assert.equal(filters[0]?.value, 'from-cache');
    });

    it('preserves case for domain values', () => {
      const filters = parseFilterString('domain:API.Example.COM');
      assert.equal(filters[0]?.value, 'API.Example.COM');
    });
  });

  describe('parseFilterString error handling', () => {
    it('throws on unknown filter type', () => {
      assert.throws(() => parseFilterString('unknown:value'), /Unknown filter type/);
    });

    it('throws on missing colon', () => {
      assert.throws(() => parseFilterString('domainexample.com'), /Expected "type:value" format/);
    });

    it('throws on missing value', () => {
      assert.throws(() => parseFilterString('domain:'), /Missing value/);
    });

    it('throws on invalid is: value', () => {
      assert.throws(() => parseFilterString('is:invalid'), /Invalid "is" filter value/);
    });

    it('throws on invalid status code', () => {
      assert.throws(() => parseFilterString('status-code:999'), /Invalid status code/);
      assert.throws(() => parseFilterString('status-code:abc'), /Invalid status code/);
    });

    it('throws on invalid size format', () => {
      assert.throws(() => parseFilterString('larger-than:invalid'), /Invalid size format/);
    });
  });
});

describe('Filter DSL validation', () => {
  describe('validateFilterString', () => {
    it('returns valid result for correct filter', () => {
      const result = validateFilterString('status-code:>=400');

      assert.equal(result.valid, true);
      if (result.valid) {
        assert.equal(result.filters.length, 1);
      }
    });

    it('returns error with suggestion for unknown type', () => {
      const result = validateFilterString('statuscode:200');

      assert.equal(result.valid, false);
      if (!result.valid) {
        assert.ok(result.error.includes('Unknown filter type'));
        assert.ok(result.suggestion?.includes('status-code'));
      }
    });

    it('returns error with suggestion for invalid is: value', () => {
      const result = validateFilterString('is:cached');

      assert.equal(result.valid, false);
      if (!result.valid) {
        assert.ok(result.suggestion?.includes('from-cache'));
      }
    });
  });
});

describe('Filter application', () => {
  const mockRequests: NetworkRequest[] = [
    createRequest({
      requestId: 'api-success',
      url: 'https://api.example.com/data',
      status: 200,
      method: 'GET',
      mimeType: 'application/json',
      resourceType: 'XHR',
      encodedDataLength: 500,
    }),
    createRequest({
      requestId: 'api-error',
      url: 'https://api.example.com/error',
      status: 500,
      method: 'POST',
      mimeType: 'application/json',
      resourceType: 'XHR',
      encodedDataLength: 100,
    }),
    createRequest({
      requestId: 'cdn-image',
      url: 'https://cdn.example.com/image.png',
      status: 200,
      method: 'GET',
      mimeType: 'image/png',
      resourceType: 'Image',
      encodedDataLength: 2 * 1024 * 1024,
    }),
    createRequest({
      requestId: 'document',
      url: 'https://example.com/page',
      status: 200,
      method: 'GET',
      mimeType: 'text/html',
      resourceType: 'Document',
      encodedDataLength: 5000,
      responseHeaders: { 'set-cookie': 'session=abc123' },
    }),
    {
      requestId: 'pending',
      url: 'https://api.example.com/slow',
      method: 'GET',
      timestamp: Date.now(),
      resourceType: 'XHR',
    },
  ];

  describe('applyFilters', () => {
    it('returns all requests when no filters', () => {
      const result = applyFilters(mockRequests, []);
      assert.equal(result.length, mockRequests.length);
    });

    it('filters by domain with wildcard', () => {
      const filters = parseFilterString('domain:api.*');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 3);
      assert.ok(result.every((r) => r.url.includes('api.example.com')));
    });

    it('filters by exact domain', () => {
      const filters = parseFilterString('domain:cdn.example.com');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'cdn-image');
    });

    it('filters by status code equality', () => {
      const filters = parseFilterString('status-code:200');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 3);
      assert.ok(result.every((r) => r.status === 200));
    });

    it('filters by status code range (>=)', () => {
      const filters = parseFilterString('status-code:>=400');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'api-error');
    });

    it('filters by status code range (<)', () => {
      const filters = parseFilterString('status-code:<300');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 3);
      assert.ok(result.every((r) => r.status !== undefined && r.status < 300));
    });

    it('filters by HTTP method', () => {
      const filters = parseFilterString('method:POST');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.method, 'POST');
    });

    it('filters by method case-insensitively', () => {
      const filters = parseFilterString('method:post');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.method, 'POST');
    });

    it('filters by MIME type', () => {
      const filters = parseFilterString('mime-type:application/json');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 2);
      assert.ok(result.every((r) => r.mimeType === 'application/json'));
    });

    it('filters by MIME type prefix', () => {
      const filters = parseFilterString('mime-type:image');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'cdn-image');
    });

    it('filters by resource type', () => {
      const filters = parseFilterString('resource-type:XHR');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 3);
      assert.ok(result.every((r) => r.resourceType === 'XHR'));
    });

    it('filters by multiple resource types', () => {
      const filters = parseFilterString('resource-type:XHR,Document');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 4);
    });

    it('filters by size threshold', () => {
      const filters = parseFilterString('larger-than:1MB');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'cdn-image');
    });

    it('filters by response header presence', () => {
      const filters = parseFilterString('has-response-header:set-cookie');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'document');
    });

    it('filters pending requests with is:running', () => {
      const filters = parseFilterString('is:running');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'pending');
    });

    it('filters by scheme', () => {
      const requests = [
        createRequest({ url: 'https://example.com/secure' }),
        createRequest({ url: 'http://example.com/insecure' }),
      ];
      const filters = parseFilterString('scheme:https');
      const result = applyFilters(requests, filters);

      assert.equal(result.length, 1);
      assert.ok(result[0]?.url.startsWith('https://'));
    });

    it('applies negation correctly', () => {
      const filters = parseFilterString('-domain:cdn.*');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 4);
      assert.ok(result.every((r) => !r.url.includes('cdn.')));
    });

    it('applies multiple filters with AND logic', () => {
      const filters = parseFilterString('domain:api.* status-code:>=400');
      const result = applyFilters(mockRequests, filters);

      assert.equal(result.length, 1);
      assert.equal(result[0]?.requestId, 'api-error');
    });

    it('handles requests with undefined status', () => {
      const filters = parseFilterString('status-code:200');
      const result = applyFilters(mockRequests, filters);

      assert.ok(!result.some((r) => r.status === undefined));
    });

    it('handles requests with undefined mimeType', () => {
      const requests: NetworkRequest[] = [
        {
          requestId: 'no-mime',
          url: 'https://example.com/data',
          method: 'GET',
          timestamp: Date.now(),
        },
      ];
      const filters = parseFilterString('mime-type:application/json');
      const result = applyFilters(requests, filters);

      assert.equal(result.length, 0);
    });
  });
});

describe('Size parsing', () => {
  describe('parseSize', () => {
    it('parses bytes', () => {
      assert.equal(parseSize('100'), 100);
      assert.equal(parseSize('100b'), 100);
      assert.equal(parseSize('100B'), 100);
    });

    it('parses kilobytes', () => {
      assert.equal(parseSize('1KB'), 1024);
      assert.equal(parseSize('1kb'), 1024);
      assert.equal(parseSize('2KB'), 2048);
    });

    it('parses megabytes', () => {
      assert.equal(parseSize('1MB'), 1024 * 1024);
      assert.equal(parseSize('1mb'), 1024 * 1024);
    });

    it('parses gigabytes', () => {
      assert.equal(parseSize('1GB'), 1024 * 1024 * 1024);
    });

    it('parses decimal values', () => {
      assert.equal(parseSize('1.5KB'), Math.floor(1.5 * 1024));
      assert.equal(parseSize('0.5MB'), Math.floor(0.5 * 1024 * 1024));
    });

    it('throws on invalid format', () => {
      assert.throws(() => parseSize('invalid'), /Invalid size format/);
      assert.throws(() => parseSize('KB'), /Invalid size format/);
      assert.throws(() => parseSize(''), /Invalid size format/);
    });
  });
});

describe('Help text', () => {
  it('getFilterHelpText returns non-empty string', () => {
    const help = getFilterHelpText();

    assert.ok(help.length > 0);
    assert.ok(help.includes('status-code'));
    assert.ok(help.includes('domain'));
    assert.ok(help.includes('Negation'));
  });
});
