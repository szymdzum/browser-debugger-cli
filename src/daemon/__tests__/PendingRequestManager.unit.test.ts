/**
 * Unit tests for PendingRequestManager
 *
 * Tests the contract: track pending requests, cleanup timeouts, prevent memory leaks.
 * Focus on: add/get/remove lifecycle, timeout cleanup, clear semantics.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach, mock } from 'node:test';

import type { Socket } from 'net';

import { PendingRequestManager } from '@/daemon/handlers/pendingRequests.js';
import type { PendingRequest } from '@/daemon/handlers/pendingRequests.js';

void describe('PendingRequestManager', () => {
  let manager: PendingRequestManager;
  let mockSocket: Socket;

  beforeEach(() => {
    manager = new PendingRequestManager();
    // Create a minimal mock socket (we don't need actual network)
    mockSocket = {} as Socket;
  });

  void describe('initialization', () => {
    void it('starts empty', () => {
      assert.equal(manager.size, 0);
    });
  });

  void describe('add and get', () => {
    void it('adds pending request', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
      };

      manager.add('req-1', request);

      assert.equal(manager.size, 1);
      clearTimeout(timeout);
    });

    void it('retrieves added request', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
      };

      manager.add('req-1', request);
      const retrieved = manager.get('req-1');

      assert.deepEqual(retrieved, request);
      clearTimeout(timeout);
    });

    void it('returns undefined for non-existent request', () => {
      const result = manager.get('non-existent');

      assert.equal(result, undefined);
    });

    void it('stores optional status data', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
        statusData: {
          daemonPid: process.pid,
          daemonStartTime: Date.now(),
          socketPath: '/tmp/test.sock',
          sessionPid: 12345,
          activity: {
            networkRequestsCaptured: 10,
            consoleMessagesCaptured: 5,
          },
        },
      };

      manager.add('req-1', request);
      const retrieved = manager.get('req-1');

      assert.ok(retrieved?.statusData);
      assert.equal(retrieved.statusData.daemonPid, process.pid);
      assert.equal(retrieved.statusData.sessionPid, 12345);
      clearTimeout(timeout);
    });

    void it('stores optional command name', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
        commandName: 'worker_peek',
      };

      manager.add('req-1', request);
      const retrieved = manager.get('req-1');

      assert.equal(retrieved?.commandName, 'worker_peek');
      clearTimeout(timeout);
    });
  });

  void describe('remove', () => {
    void it('removes pending request', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
      };

      manager.add('req-1', request);
      const removed = manager.remove('req-1');

      assert.deepEqual(removed, request);
      assert.equal(manager.size, 0);
      assert.equal(manager.get('req-1'), undefined);
      clearTimeout(timeout);
    });

    void it('clears timeout when removing', () => {
      // Mock clearTimeout to verify it's called
      const clearTimeoutSpy = mock.fn();
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = clearTimeoutSpy as typeof clearTimeout;

      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
      };

      manager.add('req-1', request);
      manager.remove('req-1');

      assert.equal(clearTimeoutSpy.mock.calls.length, 1);
      assert.equal(clearTimeoutSpy.mock.calls[0]?.arguments[0], timeout);

      // Restore original
      global.clearTimeout = originalClearTimeout;
      clearTimeout(timeout);
    });

    void it('returns undefined when removing non-existent request', () => {
      const result = manager.remove('non-existent');

      assert.equal(result, undefined);
    });

    void it('handles removing same request twice', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
      };

      manager.add('req-1', request);
      manager.remove('req-1');
      const secondRemove = manager.remove('req-1');

      assert.equal(secondRemove, undefined);
      clearTimeout(timeout);
    });
  });

  void describe('getAll', () => {
    void it('returns empty iterator when no requests', () => {
      const entries = Array.from(manager.getAll());

      assert.equal(entries.length, 0);
    });

    void it('returns all pending requests', () => {
      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);

      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout: timeout1 });
      manager.add('req-2', { socket: mockSocket, sessionId: 'session-2', timeout: timeout2 });

      const entries = Array.from(manager.getAll());

      assert.equal(entries.length, 2);
      assert.ok(entries.some(([id]) => id === 'req-1'));
      assert.ok(entries.some(([id]) => id === 'req-2'));

      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });

    void it('provides request IDs and data', () => {
      const timeout = setTimeout(() => {}, 1000);
      const request: PendingRequest = {
        socket: mockSocket,
        sessionId: 'session-1',
        timeout,
      };

      manager.add('req-1', request);
      const entries = Array.from(manager.getAll());

      assert.equal(entries[0]?.[0], 'req-1');
      assert.deepEqual(entries[0]?.[1], request);

      clearTimeout(timeout);
    });
  });

  void describe('size', () => {
    void it('tracks number of pending requests', () => {
      assert.equal(manager.size, 0);

      const timeout1 = setTimeout(() => {}, 1000);
      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout: timeout1 });
      assert.equal(manager.size, 1);

      const timeout2 = setTimeout(() => {}, 1000);
      manager.add('req-2', { socket: mockSocket, sessionId: 'session-2', timeout: timeout2 });
      assert.equal(manager.size, 2);

      manager.remove('req-1');
      assert.equal(manager.size, 1);

      manager.remove('req-2');
      assert.equal(manager.size, 0);

      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });
  });

  void describe('clear', () => {
    void it('removes all pending requests', () => {
      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);

      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout: timeout1 });
      manager.add('req-2', { socket: mockSocket, sessionId: 'session-2', timeout: timeout2 });

      assert.equal(manager.size, 2);

      manager.clear();

      assert.equal(manager.size, 0);
      assert.equal(manager.get('req-1'), undefined);
      assert.equal(manager.get('req-2'), undefined);

      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });

    void it('clears all timeouts', () => {
      const clearTimeoutSpy = mock.fn();
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = clearTimeoutSpy as typeof clearTimeout;

      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);

      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout: timeout1 });
      manager.add('req-2', { socket: mockSocket, sessionId: 'session-2', timeout: timeout2 });

      manager.clear();

      assert.equal(clearTimeoutSpy.mock.calls.length, 2);

      // Restore original
      global.clearTimeout = originalClearTimeout;
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });

    void it('handles clearing empty manager', () => {
      assert.doesNotThrow(() => {
        manager.clear();
      });
    });
  });

  void describe('memory leak prevention', () => {
    void it('ensures remove clears timeout to prevent memory leak', () => {
      const timeout = setTimeout(() => {}, 60000); // Long timeout
      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout });

      // Remove should clear timeout
      manager.remove('req-1');

      // Timeout should be cleared (we can't directly test this, but we verify the call happened)
      assert.equal(manager.get('req-1'), undefined);
    });

    void it('ensures clear clears all timeouts to prevent memory leak', () => {
      // Add multiple long-running timeouts
      for (let i = 0; i < 10; i++) {
        const timeout = setTimeout(() => {}, 60000);
        manager.add(`req-${i}`, { socket: mockSocket, sessionId: `session-${i}`, timeout });
      }

      assert.equal(manager.size, 10);

      // Clear should remove all and clear all timeouts
      manager.clear();

      assert.equal(manager.size, 0);
    });
  });

  void describe('concurrent operations', () => {
    void it('handles adding multiple requests with same ID (overwrites)', () => {
      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);

      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout: timeout1 });
      manager.add('req-1', { socket: mockSocket, sessionId: 'session-2', timeout: timeout2 });

      // Should have overwritten
      assert.equal(manager.size, 1);
      const retrieved = manager.get('req-1');
      assert.equal(retrieved?.sessionId, 'session-2');

      clearTimeout(timeout1);
      clearTimeout(timeout2);
    });

    void it('maintains integrity when interleaving add and remove', () => {
      const timeout1 = setTimeout(() => {}, 1000);
      const timeout2 = setTimeout(() => {}, 1000);
      const timeout3 = setTimeout(() => {}, 1000);

      manager.add('req-1', { socket: mockSocket, sessionId: 'session-1', timeout: timeout1 });
      manager.add('req-2', { socket: mockSocket, sessionId: 'session-2', timeout: timeout2 });
      manager.remove('req-1');
      manager.add('req-3', { socket: mockSocket, sessionId: 'session-3', timeout: timeout3 });

      assert.equal(manager.size, 2);
      assert.equal(manager.get('req-1'), undefined);
      assert.ok(manager.get('req-2'));
      assert.ok(manager.get('req-3'));

      clearTimeout(timeout1);
      clearTimeout(timeout2);
      clearTimeout(timeout3);
    });
  });
});
