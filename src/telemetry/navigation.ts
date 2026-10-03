import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('navigation');

/**
 * Navigation event information.
 */
export interface NavigationEvent {
  /** URL navigated to */
  url: string;
  /** Timestamp of navigation */
  timestamp: number;
  /** Navigation counter (increments with each main frame navigation) */
  navigationId: number;
}

/**
 * Navigation counters exposed by the tracker.
 */
export interface NavigationTracker {
  cleanup: CleanupFunction;
  /** Increments on each main-frame navigation; groups console/network data per page. */
  getCurrentNavigationId: () => number;
  /**
   * Increments on each main-frame navigation and each `DOM.documentUpdated`;
   * when it changes, previously obtained DOM node ids are no longer valid.
   */
  getDomVersion: () => number;
}

/**
 * Start tracking page navigation events.
 *
 * Keeps two counters. `navigationId` counts main-frame navigations only, so all
 * console messages and requests of one page load share an id (it used to also
 * bump on `DOM.documentUpdated`, which split a single page load across ids and
 * made `bdg console` drop early messages). `domVersion` additionally bumps on
 * `DOM.documentUpdated` and is what DOM query caches compare against.
 *
 * @param cdp - CDP connection instance
 * @param navigations - Array to populate with navigation events
 * @returns Cleanup function and counter getters
 */
export async function startNavigationTracking(
  cdp: CDPConnection,
  navigations: NavigationEvent[]
): Promise<NavigationTracker> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);
  let navigationCounter = 0;
  let domVersion = 0;

  await cdp.send('Page.enable');

  navigations.push({ url: '', timestamp: Date.now(), navigationId: navigationCounter });

  registry.registerTyped(typed, 'Page.frameNavigated', (params) => {
    if (params.frame.parentId !== undefined) return;
    navigationCounter++;
    domVersion++;
    navigations.push({
      url: params.frame.url,
      timestamp: Date.now(),
      navigationId: navigationCounter,
    });
    log.debug(`Main frame navigation detected [${navigationCounter}]: ${params.frame.url}`);
  });

  await cdp.send('DOM.enable');
  registry.registerTyped(typed, 'DOM.documentUpdated', () => {
    domVersion++;
    log.debug(`DOM document updated [dom version ${domVersion}]`);
  });

  return {
    cleanup: () => {
      registry.cleanup();
    },
    getCurrentNavigationId: () => navigationCounter,
    getDomVersion: () => domVersion,
  };
}
