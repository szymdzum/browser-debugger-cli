/**
 * Unit tests for CDPHandlerRegistry
 *
 * Tests the contract: register handlers → track them → cleanup removes all
 *
 * Philosophy: Test the public API contract, not implementation details.
 * We don't care about the internal array structure - we only care that
 * cleanup() removes all handlers that were registered.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';

describe('CDPHandlerRegistry - Handler Tracking', () => {
  test('tracks single handler correctly', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});

    assert.equal(registry.size(), 1, 'Should track one handler');
  });

  test('tracks multiple handlers correctly', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Network.loadingFinished', () => {});
    registry.register(mockCDP, 'Console.messageAdded', () => {});

    assert.equal(registry.size(), 3, 'Should track all three handlers');
  });

  test('size() starts at zero', () => {
    const registry = new CDPHandlerRegistry();

    assert.equal(registry.size(), 0, 'Empty registry should have size 0');
  });

  test('tracks handlers from different events', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    // Different events
    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Console.messageAdded', () => {});
    registry.register(mockCDP, 'Page.loadEventFired', () => {});

    assert.equal(registry.size(), 3, 'Should track handlers for different events');
  });

  test('tracks multiple handlers for same event', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    // Same event, different handlers
    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});

    assert.equal(registry.size(), 2, 'Should track multiple handlers for same event');
  });
});

describe('CDPHandlerRegistry - Cleanup', () => {
  test('cleanup removes all handlers', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Network.loadingFinished', () => {});
    registry.cleanup(mockCDP);

    // Contract: after cleanup, size should be 0
    assert.equal(registry.size(), 0, 'Cleanup should clear all handlers');
  });

  test('cleanup calls off() for each registered handler', () => {
    const registry = new CDPHandlerRegistry();
    const offCalls: Array<{ event: string; id: number }> = [];

    const mockCDP = createMockCDP();
    mockCDP.off = (event: string, id: number) => {
      offCalls.push({ event, id });
    };

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Console.messageAdded', () => {});
    registry.cleanup(mockCDP);

    // Contract: cleanup must call off() for each handler
    assert.equal(offCalls.length, 2, 'Should call off() for each handler');
    assert.equal(
      offCalls[0]?.event,
      'Network.requestWillBeSent',
      'First off() should match first handler'
    );
    assert.equal(
      offCalls[1]?.event,
      'Console.messageAdded',
      'Second off() should match second handler'
    );
  });

  test('cleanup on empty registry is safe', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    // Should not throw
    assert.doesNotThrow(() => {
      registry.cleanup(mockCDP);
    }, 'Cleanup on empty registry should be safe');
  });

  test('cleanup can be called multiple times', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.cleanup(mockCDP);
    registry.cleanup(mockCDP); // Second cleanup

    assert.equal(registry.size(), 0, 'Multiple cleanups should be safe');
  });

  test('size is zero after cleanup', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Network.loadingFinished', () => {});
    registry.register(mockCDP, 'Console.messageAdded', () => {});

    assert.equal(registry.size(), 3, 'Pre-cleanup: should have 3 handlers');
    registry.cleanup(mockCDP);
    assert.equal(registry.size(), 0, 'Post-cleanup: should have 0 handlers');
  });
});

describe('CDPHandlerRegistry - Reusability', () => {
  test('can register new handlers after cleanup', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    // First batch
    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.cleanup(mockCDP);

    // Second batch
    registry.register(mockCDP, 'Console.messageAdded', () => {});
    registry.register(mockCDP, 'Page.loadEventFired', () => {});

    assert.equal(registry.size(), 2, 'Should track new handlers after cleanup');
  });

  test('cleanup only affects registered handlers, not future ones', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();
    const offCalls: string[] = [];

    mockCDP.off = (event: string) => {
      offCalls.push(event);
    };

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.cleanup(mockCDP);
    registry.register(mockCDP, 'Console.messageAdded', () => {}); // After cleanup
    registry.cleanup(mockCDP); // Second cleanup

    // First cleanup should only remove Network handler
    // Second cleanup should only remove Console handler
    assert.equal(offCalls.length, 2, 'Should have two cleanup calls total');
    assert.equal(offCalls[0], 'Network.requestWillBeSent', 'First cleanup removes Network handler');
    assert.equal(offCalls[1], 'Console.messageAdded', 'Second cleanup removes Console handler');
  });
});

describe('CDPHandlerRegistry - Type-Safe API (registerTyped)', () => {
  test('registerTyped tracks handlers correctly', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();
    const typed = new TypedCDPConnection(mockCDP);

    registry.registerTyped(typed, 'Network.requestWillBeSent', () => {});
    registry.registerTyped(typed, 'Console.messageAdded', () => {});

    assert.equal(registry.size(), 2, 'Should track typed handlers');
  });

  test('cleanup works with typed handlers', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();
    const typed = new TypedCDPConnection(mockCDP);

    registry.registerTyped(typed, 'Network.requestWillBeSent', () => {});
    registry.registerTyped(typed, 'Network.loadingFinished', () => {});
    registry.cleanup(mockCDP);

    assert.equal(registry.size(), 0, 'Cleanup should remove typed handlers');
  });

  test('can mix legacy and typed handler registration', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();
    const typed = new TypedCDPConnection(mockCDP);

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {}); // Legacy
    registry.registerTyped(typed, 'Console.messageAdded', () => {}); // Typed

    assert.equal(registry.size(), 2, 'Should track both legacy and typed handlers');
  });

  test('cleanup removes both legacy and typed handlers', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();
    const typed = new TypedCDPConnection(mockCDP);
    const offCalls: string[] = [];

    mockCDP.off = (event: string) => {
      offCalls.push(event);
    };

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.registerTyped(typed, 'Console.messageAdded', () => {});
    registry.cleanup(mockCDP);

    assert.equal(offCalls.length, 2, 'Should cleanup both handler types');
    assert.equal(registry.size(), 0, 'Size should be zero after mixed cleanup');
  });
});

describe('CDPHandlerRegistry - Handler ID Management', () => {
  test('passes through handler IDs from on() correctly', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();
    const offCalls: number[] = [];

    // Mock returns specific IDs
    let nextId = 100;
    mockCDP.on = () => nextId++;
    mockCDP.off = (_event: string, id: number) => {
      offCalls.push(id);
    };

    registry.register(mockCDP, 'Network.requestWillBeSent', () => {});
    registry.register(mockCDP, 'Console.messageAdded', () => {});
    registry.cleanup(mockCDP);

    // Contract: cleanup should pass correct IDs to off()
    assert.deepEqual(offCalls, [100, 101], 'Should pass through correct handler IDs');
  });

  test('handles duplicate handler IDs for same event', () => {
    const registry = new CDPHandlerRegistry();
    const mockCDP = createMockCDP();

    // Same event, same handler function - CDP should return different IDs
    const handler = (): void => {};
    registry.register(mockCDP, 'Network.requestWillBeSent', handler);
    registry.register(mockCDP, 'Network.requestWillBeSent', handler);

    assert.equal(registry.size(), 2, 'Should track both handlers even if same function');
  });
});

// Test Helpers

/**
 * Create a mock CDPConnection for testing
 */
function createMockCDP(): CDPConnection {
  let handlerId = 0;

  return {
    on: (_event: string, _handler: unknown) => {
      return handlerId++;
    },
    off: (_event: string, _id: number) => {
      // No-op by default
    },
  } as unknown as CDPConnection;
}
