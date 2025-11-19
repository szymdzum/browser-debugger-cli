/**
 * HTTP Utilities Unit Tests
 *
 * Tests CDP HTTP API client functions.
 *
 * Following testing philosophy:
 * - Test the BEHAVIOR: "HTTP errors return empty arrays, not throw"
 * - Test the PROPERTY: "Timeout always triggers after specified duration"
 * - Mock the BOUNDARY: fetch() (external HTTP dependency)
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { fetchCDPTargetById, fetchCDPTargets } from '@/utils/http.js';

void describe('HTTP Utilities', () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = mock.fn(global.fetch);
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  void describe('fetchCDPTargets()', () => {
    void it('returns array of targets when HTTP request succeeds', async () => {
      const mockTargets = [
        {
          id: 'target-1',
          title: 'Page 1',
          url: 'http://localhost:3000',
          webSocketDebuggerUrl: 'ws://...',
        },
        {
          id: 'target-2',
          title: 'Page 2',
          url: 'http://localhost:3001',
          webSocketDebuggerUrl: 'ws://...',
        },
      ];

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTargets),
        })
      );

      const result = await fetchCDPTargets(9222);

      assert.ok(Array.isArray(result), 'Result should be an array');
      assert.equal(result.length, 2, 'Should return 2 targets');
      assert.equal(result[0]?.id, 'target-1');
      assert.equal(result[1]?.id, 'target-2');
    });

    void it('returns empty array when HTTP response is not ok (404, 500, etc.)', async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
      );

      const result = await fetchCDPTargets(9222);

      assert.ok(Array.isArray(result), 'Result should be an array');
      assert.equal(result.length, 0, 'Should return empty array on HTTP error');
    });

    void it('returns empty array when response is not valid JSON array', async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ error: 'Invalid format' }),
        })
      );

      const result = await fetchCDPTargets(9222);

      assert.ok(Array.isArray(result), 'Result should be an array');
      assert.equal(result.length, 0, 'Should return empty array when response is not array');
    });

    void it('returns empty array when network error occurs', async () => {
      fetchMock.mock.mockImplementation(() => Promise.reject(new Error('Network error')));

      const result = await fetchCDPTargets(9222);

      assert.ok(Array.isArray(result), 'Result should be an array');
      assert.equal(result.length, 0, 'Should return empty array on network error');
    });

    void it('returns empty array when request times out after 5 seconds', async () => {
      fetchMock.mock.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          // Simulate timeout by checking if signal is aborted
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              const error = new Error('Request aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }
        });
      });

      const result = await fetchCDPTargets(9222);

      assert.ok(Array.isArray(result), 'Result should be an array');
      assert.equal(result.length, 0, 'Should return empty array on timeout');
    });

    void it('uses default port 9222 when port not specified', async () => {
      let requestedUrl = '';

      fetchMock.mock.mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      await fetchCDPTargets();

      assert.ok(requestedUrl.includes(':9222'), 'Should use default port 9222');
    });

    void it('uses custom port when specified', async () => {
      let requestedUrl = '';

      fetchMock.mock.mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      await fetchCDPTargets(9223);

      assert.ok(requestedUrl.includes(':9223'), 'Should use custom port 9223');
    });

    void it('constructs correct CDP HTTP endpoint URL', async () => {
      let requestedUrl = '';

      fetchMock.mock.mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      await fetchCDPTargets(9222);

      assert.ok(requestedUrl.startsWith('http://'), 'Should use HTTP protocol');
      assert.ok(requestedUrl.includes('/json/list'), 'Should use /json/list endpoint');
      assert.ok(requestedUrl.includes('127.0.0.1'), 'Should use localhost');
    });
  });

  void describe('fetchCDPTargetById()', () => {
    void it('returns matching target when ID exists', async () => {
      const mockTargets = [
        {
          id: 'target-1',
          title: 'Page 1',
          url: 'http://localhost:3000',
          webSocketDebuggerUrl: 'ws://...',
        },
        {
          id: 'target-2',
          title: 'Page 2',
          url: 'http://localhost:3001',
          webSocketDebuggerUrl: 'ws://...',
        },
      ];

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTargets),
        })
      );

      const result = await fetchCDPTargetById('target-2', 9222);

      assert.ok(result !== null, 'Should return a target');
      assert.equal(result?.id, 'target-2');
      assert.equal(result?.title, 'Page 2');
    });

    void it('returns null when target ID not found', async () => {
      const mockTargets = [
        {
          id: 'target-1',
          title: 'Page 1',
          url: 'http://localhost:3000',
          webSocketDebuggerUrl: 'ws://...',
        },
      ];

      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTargets),
        })
      );

      const result = await fetchCDPTargetById('nonexistent', 9222);

      assert.equal(result, null, 'Should return null when target not found');
    });

    void it('returns null when HTTP request fails', async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        })
      );

      const result = await fetchCDPTargetById('target-1', 9222);

      assert.equal(result, null, 'Should return null on HTTP error');
    });

    void it('returns null when network error occurs', async () => {
      fetchMock.mock.mockImplementation(() => Promise.reject(new Error('Network error')));

      const result = await fetchCDPTargetById('target-1', 9222);

      assert.equal(result, null, 'Should return null on network error');
    });

    void it('returns null when targets list is empty', async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        })
      );

      const result = await fetchCDPTargetById('target-1', 9222);

      assert.equal(result, null, 'Should return null when no targets found');
    });

    void it('uses default port 9222 when port not specified', async () => {
      let requestedUrl = '';

      fetchMock.mock.mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      await fetchCDPTargetById('target-1');

      assert.ok(requestedUrl.includes(':9222'), 'Should use default port 9222');
    });
  });

  void describe('Error handling consistency', () => {
    void it('both functions handle errors the same way (return empty/null, not throw)', async () => {
      fetchMock.mock.mockImplementation(() => Promise.reject(new Error('Network failure')));

      const targetsResult = await fetchCDPTargets(9222);
      const targetResult = await fetchCDPTargetById('target-1', 9222);

      assert.ok(Array.isArray(targetsResult), 'fetchCDPTargets should return array');
      assert.equal(targetsResult.length, 0, 'fetchCDPTargets should return empty array');
      assert.equal(targetResult, null, 'fetchCDPTargetById should return null');
    });
  });
});
