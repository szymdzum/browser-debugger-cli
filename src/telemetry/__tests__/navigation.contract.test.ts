/**
 * Navigation tracking contract tests
 *
 * Tests the public API behavior of startNavigationTracking WITHOUT testing implementation details.
 * Follows the testing philosophy: "Test the contract, not the implementation"
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { NavigationEvent } from '@/telemetry/navigation.js';
import { startNavigationTracking } from '@/telemetry/navigation.js';

/**
 * Mock CDP connection for testing navigation tracking.
 * Only mocks the CDP boundary - all telemetry logic is real.
 */
class MockCDPConnection {
  private eventHandlers = new Map<string, Map<number, (params: unknown) => void>>();
  private nextHandlerId = 0;
  private sendCalls: Array<{ method: string; params?: unknown }> = [];

  send(method: string, params?: unknown): Promise<unknown> {
    this.sendCalls.push({ method, params });
    return Promise.resolve({});
  }

  on<T>(event: string, handler: (params: T) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Map());
    }
    const id = this.nextHandlerId++;
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.set(id, handler as (params: unknown) => void);
    }
    return () => this.off(event, id);
  }

  off(event: string, handlerId: number): void {
    this.eventHandlers.get(event)?.delete(handlerId);
  }

  emit<T>(event: string, params: T): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(params));
    }
  }

  wasPageEnabled(): boolean {
    return this.sendCalls.some((call) => call.method === 'Page.enable');
  }

  getHandlerCount(event: string): number {
    return this.eventHandlers.get(event)?.size ?? 0;
  }
}

/**
 * Test helper - create minimal Protocol.Page.Frame with required fields
 */
function createTestFrame(partial: Partial<Protocol.Page.Frame>): Protocol.Page.Frame {
  return {
    id: '',
    loaderId: '',
    url: '',
    securityOrigin: '',
    mimeType: 'text/html',
    domainAndRegistry: '',
    secureContextType: 'Secure',
    crossOriginIsolatedContextType: 'Isolated',
    gatedAPIFeatures: [],
    ...partial,
  };
}

describe('startNavigationTracking contract', () => {
  it('should enable Page domain on initialization', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    await startNavigationTracking(mockCdp, navigations);

    assert.equal((mockCdp as unknown as MockCDPConnection).wasPageEnabled(), true);
  });

  it('should record initial navigation event with navigationId 0', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    await startNavigationTracking(mockCdp, navigations);

    assert.equal(navigations.length, 1);
    const nav = navigations[0];
    assert.ok(nav, 'First navigation should exist');
    assert.equal(nav.navigationId, 0);
    assert.equal(nav.url, '');
    assert.equal(typeof nav.timestamp, 'number');
  });

  it('should track main frame navigations and increment navigationId', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    await startNavigationTracking(mockCdp, navigations);

    const mainFrameNav: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'main-frame',
        url: 'http://localhost:3000/',
        loaderId: 'loader1',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', mainFrameNav);

    assert.equal(navigations.length, 2);
    const nav1 = navigations[1];
    assert.ok(nav1, 'Second navigation should exist');
    assert.equal(nav1.navigationId, 1);
    assert.equal(nav1.url, 'http://localhost:3000/');
  });

  it('should ignore iframe navigations (only track main frame)', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    await startNavigationTracking(mockCdp, navigations);

    const iframeNav: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'iframe-1',
        parentId: 'main-frame',
        url: 'http://localhost:3000/iframe',
        loaderId: 'loader2',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', iframeNav);

    assert.equal(navigations.length, 1);
  });

  it('should increment navigationId for each main frame navigation', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    await startNavigationTracking(mockCdp, navigations);

    const nav1: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'main',
        url: 'http://localhost:3000/',
        loaderId: 'loader1',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    const nav2: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'main',
        url: 'http://localhost:3000/about',
        loaderId: 'loader2',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    const nav3: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'main',
        url: 'http://localhost:3000/contact',
        loaderId: 'loader3',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', nav1);
    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', nav2);
    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', nav3);

    assert.equal(navigations.length, 4);
    assert.ok(navigations[0], 'Navigation 0 should exist');
    assert.ok(navigations[1], 'Navigation 1 should exist');
    assert.ok(navigations[2], 'Navigation 2 should exist');
    assert.ok(navigations[3], 'Navigation 3 should exist');
    assert.equal(navigations[0].navigationId, 0);
    assert.equal(navigations[1].navigationId, 1);
    assert.equal(navigations[1].url, 'http://localhost:3000/');
    assert.equal(navigations[2].navigationId, 2);
    assert.equal(navigations[2].url, 'http://localhost:3000/about');
    assert.equal(navigations[3].navigationId, 3);
    assert.equal(navigations[3].url, 'http://localhost:3000/contact');
  });

  it('should return current navigationId via getCurrentNavigationId', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    const { getCurrentNavigationId } = await startNavigationTracking(mockCdp, navigations);

    assert.equal(getCurrentNavigationId(), 0);

    const nav: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'main',
        url: 'http://localhost:3000/',
        loaderId: 'loader1',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', nav);

    assert.equal(getCurrentNavigationId(), 1);
  });

  it('should clean up event handlers when cleanup is called', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    const { cleanup } = await startNavigationTracking(mockCdp, navigations);

    assert.equal(
      (mockCdp as unknown as MockCDPConnection).getHandlerCount('Page.frameNavigated'),
      1
    );

    cleanup();

    assert.equal(
      (mockCdp as unknown as MockCDPConnection).getHandlerCount('Page.frameNavigated'),
      0
    );
  });

  it('should not track navigations after cleanup is called', async () => {
    const mockCdp = new MockCDPConnection() as unknown as CDPConnection;
    const navigations: NavigationEvent[] = [];

    const { cleanup } = await startNavigationTracking(mockCdp, navigations);

    cleanup();

    const nav: Protocol.Page.FrameNavigatedEvent = {
      frame: createTestFrame({
        id: 'main',
        url: 'http://localhost:3000/',
        loaderId: 'loader1',
        securityOrigin: 'http://localhost:3000',
      }),
      type: 'Navigation',
    };

    (mockCdp as unknown as MockCDPConnection).emit('Page.frameNavigated', nav);

    assert.equal(navigations.length, 1);
  });
});
