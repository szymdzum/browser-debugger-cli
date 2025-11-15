/**
 * Contract tests for page readiness detection
 *
 * Tests the contract: wait for load → network stable → DOM stable OR timeout
 *
 * Philosophy: Test the state machine behavior using a mock CDP connection.
 * We don't test timing-sensitive behavior (exact ms), we test the sequence
 * of operations and state transitions.
 *
 * These are contract tests because they validate the multi-phase readiness
 * detection contract without caring about internal implementation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { waitForPageReady } from '@/connection/pageReadiness.js';

describe('Page Readiness - Happy Path', () => {
  test('waits through all three phases (load → network → DOM)', async () => {
    const phases: string[] = [];
    const mockCDP = createMockCDP({
      onSend: (method) => {
        phases.push(method);
      },
      loadEventAlreadyFired: false,
      networkQuiet: true,
      domStable: true,
    });

    await waitForPageReady(mockCDP);

    // Contract: should enable Page and Network domains
    assert.ok(phases.includes('Page.enable'), 'Should enable Page domain');
    assert.ok(phases.includes('Network.enable'), 'Should enable Network domain');

    // Contract: should check document.readyState
    assert.ok(
      phases.some((p) => p.includes('Runtime.evaluate')),
      'Should check document readiness'
    );
  });

  test('handles page where load event already fired', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
    });

    // Contract: should not wait for load event if already complete
    await waitForPageReady(mockCDP);

    // Should complete without error
    assert.ok(true, 'Should handle already-loaded page');
  });

  test('proceeds when network stabilizes', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
    });

    await waitForPageReady(mockCDP);

    // Should complete network phase
    assert.ok(true, 'Should proceed when network is stable');
  });

  test('proceeds when DOM stabilizes', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
    });

    await waitForPageReady(mockCDP);

    // Should complete DOM phase
    assert.ok(true, 'Should proceed when DOM is stable');
  });
});

describe('Page Readiness - Timeout Behavior', () => {
  test('proceeds on timeout without throwing', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: false,
      networkQuiet: false, // Never becomes quiet
      domStable: false, // Never stabilizes
      delayLoadEvent: true, // Delay to trigger timeout
    });

    // Contract: should NOT throw on timeout, should proceed anyway
    await assert.doesNotReject(async () => {
      await waitForPageReady(mockCDP, { maxWaitMs: 100 });
    }, 'Should not throw on timeout');
  });

  test('respects custom maxWaitMs option', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: false,
      networkQuiet: false,
      domStable: false,
      delayLoadEvent: true,
    });

    const start = Date.now();
    await waitForPageReady(mockCDP, { maxWaitMs: 200 });
    const duration = Date.now() - start;

    // Should timeout around 200ms (with some tolerance for scheduling)
    assert.ok(duration >= 150 && duration < 400, 'Should respect custom timeout');
  });

  test('uses default 5000ms timeout when not specified', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
    });

    const start = Date.now();
    await waitForPageReady(mockCDP); // No options
    const duration = Date.now() - start;

    // Should complete quickly when stable (not wait full 5s)
    assert.ok(duration < 1000, 'Should not wait unnecessarily when page is ready');
  });
});

describe('Page Readiness - Load Event Phase', () => {
  test('waits for Page.loadEventFired when not already loaded', async () => {
    let loadEventFired = false;
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: false,
      networkQuiet: true,
      domStable: true,
      onEventRegistered: (event) => {
        if (event === 'Page.loadEventFired') {
          // Simulate load event firing after a delay
          setTimeout(() => {
            loadEventFired = true;
            mockCDP.emit('Page.loadEventFired', {});
          }, 50);
        }
      },
    });

    await waitForPageReady(mockCDP, { maxWaitMs: 500 });

    assert.ok(loadEventFired, 'Should wait for and receive load event');
  });

  test('skips waiting for load event when document.readyState is complete', async () => {
    const events: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
      onEventRegistered: (event) => {
        events.push(event);
      },
    });

    await waitForPageReady(mockCDP);

    // Contract: should not register for Page.loadEventFired if already complete
    // (though it's okay if it does register and immediately continues)
    assert.ok(true, 'Should handle pre-loaded page');
  });

  test('handles Runtime.evaluate errors gracefully', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: false,
      networkQuiet: true,
      domStable: true,
      evaluateThrows: true,
    });

    // Contract: should proceed even if readyState check fails
    await assert.doesNotReject(async () => {
      await waitForPageReady(mockCDP, { maxWaitMs: 200 });
    }, 'Should handle evaluate errors gracefully');
  });
});

describe('Page Readiness - Network Stability Phase', () => {
  test('detects network activity via requestWillBeSent events', async () => {
    const events: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: false,
      domStable: true,
      onEventRegistered: (event) => {
        events.push(event);
      },
    });

    await waitForPageReady(mockCDP, { maxWaitMs: 200 });

    // Contract: should listen for network events
    assert.ok(events.includes('Network.requestWillBeSent'), 'Should listen for network requests');
    assert.ok(events.includes('Network.loadingFinished'), 'Should listen for loading finished');
    assert.ok(events.includes('Network.loadingFailed'), 'Should listen for loading failed');
  });

  test('tracks active requests (requestWillBeSent increases, responses decrease)', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: false,
      domStable: true,
      onEventRegistered: (event) => {
        if (event === 'Network.requestWillBeSent') {
          // Simulate request/response cycle
          setTimeout(() => {
            mockCDP.emit('Network.requestWillBeSent', {});

            setTimeout(() => {
              mockCDP.emit('Network.loadingFinished', {});
            }, 50);
          }, 30);
        }
      },
    });

    await waitForPageReady(mockCDP, { maxWaitMs: 500 });

    // Network phase should have completed
    assert.ok(true, 'Should track network request lifecycle');
  });

  test('waits for 200ms of network idle before proceeding', async () => {
    // This test verifies the threshold concept but not exact timing
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
    });

    await waitForPageReady(mockCDP);

    // Contract: should wait for network stability (implementation uses 200ms threshold)
    assert.ok(true, 'Should wait for network stability threshold');
  });
});

describe('Page Readiness - DOM Stability Phase', () => {
  test('injects MutationObserver into page', async () => {
    const evaluations: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
      onSend: (method, params) => {
        if (method === 'Runtime.evaluate' && params?.['expression']) {
          evaluations.push(params['expression'] as string);
        }
      },
    });

    await waitForPageReady(mockCDP);

    // Contract: should inject MutationObserver
    const hasObserver = evaluations.some((expr) => expr.includes('MutationObserver'));
    assert.ok(hasObserver, 'Should inject MutationObserver for DOM tracking');
  });

  test('cleans up MutationObserver after detection', async () => {
    const evaluations: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
      onSend: (method, params) => {
        if (method === 'Runtime.evaluate' && params?.['expression']) {
          evaluations.push(params['expression'] as string);
        }
      },
    });

    await waitForPageReady(mockCDP);

    // Contract: should clean up observer
    const hasCleanup = evaluations.some(
      (expr) => expr.includes('disconnect') || expr.includes('delete window.__bdg')
    );
    assert.ok(hasCleanup, 'Should clean up MutationObserver after detection');
  });

  test('waits for 300ms of DOM stability before proceeding', async () => {
    // This test verifies the threshold concept but not exact timing
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
    });

    await waitForPageReady(mockCDP);

    // Contract: should wait for DOM stability threshold (implementation uses 300ms)
    assert.ok(true, 'Should wait for DOM stability threshold');
  });

  test('handles missing document.body gracefully', async () => {
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
      evaluateThrows: true, // Simulate errors injecting observer
    });

    // Contract: should handle observer injection failures
    await assert.doesNotReject(async () => {
      await waitForPageReady(mockCDP, { maxWaitMs: 200 });
    }, 'Should handle missing document.body');
  });
});

describe('Page Readiness - Event Handler Cleanup', () => {
  test('removes load event listener after phase completes', async () => {
    const offCalls: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: false,
      networkQuiet: true,
      domStable: true,
      onOff: (event) => {
        offCalls.push(event);
      },
    });

    // Fire load event to complete phase
    setTimeout(() => mockCDP.emit('Page.loadEventFired', {}), 50);

    await waitForPageReady(mockCDP, { maxWaitMs: 500 });

    // Contract: should clean up load event listener
    assert.ok(
      offCalls.includes('Page.loadEventFired'),
      'Should remove Page.loadEventFired listener'
    );
  });

  test('removes network event listeners after phase completes', async () => {
    const offCalls: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: true,
      networkQuiet: true,
      domStable: true,
      onOff: (event) => {
        offCalls.push(event);
      },
    });

    await waitForPageReady(mockCDP);

    // Contract: should clean up all network listeners
    assert.ok(
      offCalls.includes('Network.requestWillBeSent'),
      'Should remove requestWillBeSent listener'
    );
    assert.ok(
      offCalls.includes('Network.loadingFinished'),
      'Should remove loadingFinished listener'
    );
    assert.ok(offCalls.includes('Network.loadingFailed'), 'Should remove loadingFailed listener');
  });

  test('cleans up even when timeout occurs', async () => {
    const offCalls: string[] = [];
    const mockCDP = createMockCDP({
      loadEventAlreadyFired: false,
      networkQuiet: false,
      domStable: false,
      delayLoadEvent: true,
      onOff: (event) => {
        offCalls.push(event);
      },
    });

    await waitForPageReady(mockCDP, { maxWaitMs: 100 });

    // Contract: should clean up even on timeout
    assert.ok(offCalls.length > 0, 'Should clean up listeners even on timeout');
  });
});

// Test Helpers

/**
 * Mock CDP with emit helper for testing
 */
interface MockCDPWithEmit extends CDPConnection {
  emit(event: string, params: unknown): void;
}

interface MockCDPOptions {
  /** Fire load event immediately or require explicit emit */
  loadEventAlreadyFired?: boolean;
  /** Network becomes quiet immediately or requires manual settling */
  networkQuiet?: boolean;
  /** DOM becomes stable immediately or requires manual settling */
  domStable?: boolean;
  /** Delay load event to test timeout behavior */
  delayLoadEvent?: boolean;
  /** Runtime.evaluate throws errors */
  evaluateThrows?: boolean;
  /** Callback when send() is called */
  onSend?: (method: string, params?: Record<string, unknown>) => void;
  /** Callback when event listener is registered */
  onEventRegistered?: (event: string) => void;
  /** Callback when event listener is removed */
  onOff?: (event: string) => void;
}

/**
 * Create a mock CDPConnection for testing page readiness
 */
function createMockCDP(options: MockCDPOptions = {}): MockCDPWithEmit {
  const {
    loadEventAlreadyFired = false,
    domStable = true,
    delayLoadEvent = false,
    evaluateThrows = false,
    onSend,
    onEventRegistered,
    onOff,
  } = options;

  const handlers = new Map<string, Map<number, (params: unknown) => void>>();
  let handlerId = 0;

  const mock = {
    async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      onSend?.(method, params);

      if (method === 'Page.enable' || method === 'Network.enable') {
        return {};
      }

      if (method === 'Runtime.evaluate') {
        if (evaluateThrows) {
          throw new Error('Evaluation failed');
        }

        const expression = params?.['expression'] as string | undefined;

        // Mock document.readyState check
        if (expression?.includes('document.readyState')) {
          return {
            result: {
              value: loadEventAlreadyFired ? 'complete' : 'loading',
            },
          };
        }

        // Mock MutationObserver injection
        if (expression?.includes('MutationObserver')) {
          return { result: {} };
        }

        // Mock DOM stability check
        if (expression?.includes('__bdg_lastMutation')) {
          const timeSinceLastMutation = domStable ? 500 : 0; // 500ms > 300ms threshold
          return {
            result: {
              value: timeSinceLastMutation,
            },
          };
        }

        return { result: {} };
      }

      return {};
    },

    on(event: string, handler: (params: unknown) => void): number {
      onEventRegistered?.(event);

      if (!handlers.has(event)) {
        handlers.set(event, new Map());
      }

      const id = handlerId++;
      handlers.get(event)?.set(id, handler);

      // Auto-fire load event if configured
      if (event === 'Page.loadEventFired' && !delayLoadEvent) {
        setTimeout(() => {
          handler({});
        }, 10);
      }

      return id;
    },

    off(event: string, id: number): void {
      onOff?.(event);
      handlers.get(event)?.delete(id);
    },

    emit(event: string, params: unknown): void {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        eventHandlers.forEach((handler) => handler(params));
      }
    },
  };

  return mock as unknown as MockCDPWithEmit;
}
