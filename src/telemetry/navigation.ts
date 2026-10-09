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
}

/**
 * Start tracking page navigation events.
 *
 * `navigationId` counts main-frame navigations only, so all console messages
 * and requests of one page load share an id.
 *
 * Started again on another tab (`bdg page switch`), the count goes on: the
 * tab's page is the next navigation, so ids stay unique within the session.
 *
 * @param cdp - CDP connection instance
 * @param navigations - Array to populate with navigation events
 * @param tabUrl - URL of the tab's page, when tracking moves to another tab
 * @returns Cleanup function and counter getters
 */
export async function startNavigationTracking(
  cdp: CDPConnection,
  navigations: NavigationEvent[],
  tabUrl = ''
): Promise<NavigationTracker> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);
  const last = navigations.at(-1);
  let navigationCounter = last === undefined ? 0 : last.navigationId + 1;

  await cdp.send('Page.enable');

  navigations.push({ url: tabUrl, timestamp: Date.now(), navigationId: navigationCounter });

  registry.registerTyped(typed, 'Page.frameNavigated', (params) => {
    if (params.frame.parentId !== undefined) return;
    navigationCounter++;
    navigations.push({
      url: params.frame.url,
      timestamp: Date.now(),
      navigationId: navigationCounter,
    });
    log.debug(`Main frame navigation detected [${navigationCounter}]: ${params.frame.url}`);
  });

  return {
    cleanup: () => {
      registry.cleanup();
    },
    getCurrentNavigationId: () => navigationCounter,
  };
}
