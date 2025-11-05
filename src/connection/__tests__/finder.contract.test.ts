import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { createMockTarget, mockTargetList } from '@/__testfixtures__/connectionTargets.js';
import { validateTarget } from '@/connection/finder.js';
import { DEFAULT_CDP_PORT } from '@/constants.js';

// Mock fetch globally for HTTP endpoints
let originalFetch: typeof fetch;
let fetchCallHistory: Array<{ url: string; options: RequestInit | undefined }>;
let fetchMockResponses: Array<Response | Promise<Response>>;
let fetchCallCount: number;

function setupFetchMock(): void {
  originalFetch = global.fetch;
  fetchCallHistory = [];
  fetchMockResponses = [];
  fetchCallCount = 0;

  global.fetch = ((url: string, options?: RequestInit) => {
    fetchCallHistory.push({ url, options });
    const responseIndex = fetchCallCount++;
    const response = fetchMockResponses[responseIndex];
    if (response) {
      return response;
    }
    return Promise.reject(new Error(`Unexpected fetch call ${responseIndex + 1}: ${url}`));
  }) as typeof fetch;
}

function mockFetchResponse(response: Response | Promise<Response>): void {
  fetchMockResponses.push(response);
}

function createSuccessResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response;
}

function createFailureResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
  } as Response;
}

void describe('Target Validation Contract', () => {
  beforeEach(() => {
    setupFetchMock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  void describe('validateTarget', () => {
    void it('returns true when target exists in Chrome', async () => {
      // Arrange: Mock target list containing the target
      const targetId = 'target-123';
      const existingTarget = createMockTarget({ id: targetId });

      mockFetchResponse(createSuccessResponse([existingTarget, ...mockTargetList]));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Target is found
      assert.equal(result, true);

      // Verify correct HTTP endpoint was called
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.ok(firstCall.url.includes('/json/list'));
      assert.ok(firstCall.url.includes(`127.0.0.1:${DEFAULT_CDP_PORT}`));
    });

    void it('returns false when target does not exist', async () => {
      // Arrange: Mock target list without the target
      const targetId = 'missing-target-456';

      mockFetchResponse(createSuccessResponse(mockTargetList));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Target is not found
      assert.equal(result, false);

      // Verify HTTP endpoint was called
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.ok(firstCall.url.includes('/json/list'));
    });

    void it('returns false when HTTP request fails', async () => {
      // Arrange: Mock HTTP failure
      const targetId = 'target-123';

      mockFetchResponse(createFailureResponse(500, 'Internal Server Error'));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Failure is handled gracefully
      assert.equal(result, false);

      // Verify HTTP endpoint was attempted
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.ok(firstCall.url.includes('/json/list'));
    });

    void it('returns false when response is malformed', async () => {
      // Arrange: Mock malformed JSON response
      const targetId = 'target-123';
      const malformedResponse = {
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Invalid JSON')),
      } as Response;

      mockFetchResponse(malformedResponse);

      // Act
      const result = await validateTarget(targetId);

      // Assert: Malformed response handled gracefully
      assert.equal(result, false);
    });

    void it('uses correct port parameter', async () => {
      // Arrange: Test with custom port
      const targetId = 'target-123';
      const customPort = 9333;
      const existingTarget = createMockTarget({ id: targetId });

      mockFetchResponse(createSuccessResponse([existingTarget]));

      // Act
      const result = await validateTarget(targetId, customPort);

      // Assert: Target found and custom port used
      assert.equal(result, true);

      // Verify custom port was used in HTTP call
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.ok(firstCall.url.includes(`127.0.0.1:${customPort}`));
      assert.ok(!firstCall.url.includes(`127.0.0.1:${DEFAULT_CDP_PORT}`));
    });

    void it('uses default port when not specified', async () => {
      // Arrange: Call without port parameter
      const targetId = 'target-123';
      const existingTarget = createMockTarget({ id: targetId });

      mockFetchResponse(createSuccessResponse([existingTarget]));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Uses default port
      assert.equal(result, true);

      // Verify default port was used
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.ok(firstCall.url.includes(`127.0.0.1:${DEFAULT_CDP_PORT}`));
    });

    void it('handles network errors gracefully', async () => {
      // Arrange: Mock network error (connection refused, etc.)
      const targetId = 'target-123';

      mockFetchResponse(Promise.reject(new Error('ECONNREFUSED')));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Network error handled gracefully
      assert.equal(result, false);
    });

    void it('handles empty target list', async () => {
      // Arrange: Mock empty target list from Chrome
      const targetId = 'target-123';

      mockFetchResponse(createSuccessResponse([]));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Empty list handled correctly
      assert.equal(result, false);
    });

    void it('handles target list with multiple matching IDs', async () => {
      // Arrange: Mock target list with duplicate IDs (edge case)
      const targetId = 'target-123';
      const target1 = createMockTarget({ id: targetId, url: 'http://example.com/1' });
      const target2 = createMockTarget({ id: targetId, url: 'http://example.com/2' });

      mockFetchResponse(createSuccessResponse([target1, target2]));

      // Act
      const result = await validateTarget(targetId);

      // Assert: First match is sufficient
      assert.equal(result, true);
    });
  });

  void describe('URL Construction', () => {
    void it('constructs correct Chrome endpoint URL', async () => {
      // Arrange
      const targetId = 'target-123';
      const port = 9555;

      mockFetchResponse(createSuccessResponse([]));

      // Act
      await validateTarget(targetId, port);

      // Assert: Correct URL format
      const expectedUrl = `http://127.0.0.1:${port}/json/list`;
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.equal(firstCall.url, expectedUrl);
    });

    void it('uses localhost IP address consistently', async () => {
      // Arrange
      const targetId = 'target-123';

      mockFetchResponse(createSuccessResponse([]));

      // Act
      await validateTarget(targetId);

      // Assert: Uses 127.0.0.1 (not localhost hostname)
      assert.equal(fetchCallHistory.length, 1);
      const [firstCall] = fetchCallHistory;
      assert.ok(firstCall, 'fetchCallHistory should have at least one entry');
      assert.ok(firstCall.url.includes('127.0.0.1'));
      assert.ok(!firstCall.url.includes('localhost'));
    });
  });

  void describe('Edge Cases', () => {
    void it('handles very long target IDs', async () => {
      // Arrange: Create large target list (performance test)
      const targetId = 'needle-in-haystack';
      const largeTargetList = Array.from({ length: 1000 }, (_, i) =>
        createMockTarget({ id: `target-${i}` })
      );
      largeTargetList.push(createMockTarget({ id: targetId })); // Add target at end

      mockFetchResponse(createSuccessResponse(largeTargetList));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Finds target even in large list
      assert.equal(result, true);
    });

    void it('handles targets with special characters in ID', async () => {
      // Arrange: Target with special characters
      const targetId = 'target-with-special-chars-!@#$%^&*()';
      const specialTarget = createMockTarget({ id: targetId });

      mockFetchResponse(createSuccessResponse([specialTarget]));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Special characters handled correctly
      assert.equal(result, true);
    });

    void it('handles null and undefined target IDs in list', async () => {
      // Arrange: Malformed target list with null/undefined IDs
      const targetId = 'valid-target';
      const validTarget = createMockTarget({ id: targetId });
      const malformedTargets = [
        { ...createMockTarget(), id: null },
        { ...createMockTarget(), id: undefined },
        validTarget,
      ];

      mockFetchResponse(createSuccessResponse(malformedTargets));

      // Act
      const result = await validateTarget(targetId);

      // Assert: Finds valid target despite malformed entries
      assert.equal(result, true);
    });
  });
});
