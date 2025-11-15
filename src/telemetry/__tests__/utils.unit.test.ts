/**
 * Unit tests for telemetry utility functions
 *
 * Tests the public contract of shared utilities used across telemetry collectors.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withTimeout, pushWithLimit } from '@/telemetry/utils.js';

describe('withTimeout', () => {
  it('should resolve when promise completes before timeout', async () => {
    const promise = Promise.resolve(42);
    const result = await withTimeout(promise, 1000, 'test');
    assert.equal(result, 42);
  });

  it('should reject when promise times out', async () => {
    const promise = new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(async () => withTimeout(promise, 10, 'test-operation'), {
      message: 'CDP test-operation timed out after 10ms',
    });
  });

  it('should reject with original error when promise rejects before timeout', async () => {
    const promise = Promise.reject(new Error('Original error'));
    await assert.rejects(async () => withTimeout(promise, 1000, 'test'), {
      message: 'Original error',
    });
  });

  it('should include operation label in timeout error', async () => {
    const promise = new Promise(() => {});
    await assert.rejects(async () => withTimeout(promise, 10, 'DOM.getDocument'), {
      message: /DOM\.getDocument timed out/,
    });
  });
});

describe('pushWithLimit', () => {
  it('should add item when buffer is below limit', () => {
    const buffer: number[] = [1, 2, 3];
    let callbackCalled = false;

    pushWithLimit(buffer, 4, 10, () => {
      callbackCalled = true;
    });

    assert.deepEqual(buffer, [1, 2, 3, 4]);
    assert.equal(callbackCalled, false);
  });

  it('should call callback exactly once when limit is reached', () => {
    const buffer: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    let callCount = 0;

    pushWithLimit(buffer, 10, 10, () => {
      callCount++;
    });

    assert.equal(buffer.length, 10);
    assert.equal(callCount, 1);
  });

  it('should not call callback multiple times when already at limit', () => {
    const buffer: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    let callCount = 0;

    pushWithLimit(buffer, 10, 10, () => {
      callCount++;
    });
    pushWithLimit(buffer, 11, 10, () => {
      callCount++;
    });
    pushWithLimit(buffer, 12, 10, () => {
      callCount++;
    });

    assert.equal(buffer.length, 10);
    assert.equal(callCount, 1);
  });

  it('should silently drop items beyond limit', () => {
    const buffer: number[] = [1, 2, 3];
    const limit = 3;

    pushWithLimit(buffer, 4, limit, () => {});
    pushWithLimit(buffer, 5, limit, () => {});

    assert.equal(buffer.length, 3);
    assert.deepEqual(buffer, [1, 2, 3]);
  });

  it('should work with different item types', () => {
    const buffer: string[] = ['a', 'b'];

    pushWithLimit(buffer, 'c', 5, () => {});

    assert.deepEqual(buffer, ['a', 'b', 'c']);
  });

  it('should handle zero limit correctly', () => {
    const buffer: number[] = [];
    let callbackCalled = false;

    pushWithLimit(buffer, 1, 0, () => {
      callbackCalled = true;
    });

    assert.equal(buffer.length, 0);
    assert.equal(callbackCalled, false);
  });
});
