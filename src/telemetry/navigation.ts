import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { CleanupFunction } from '@/types';
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
 * Start tracking page navigation events.
 *
 * Monitors main frame navigations (page loads, URL changes) and maintains
 * a navigation counter that increments with each navigation. This counter
 * can be used to detect stale references (e.g., network request indices
 * from a previous page load).
 *
 * @param cdp - CDP connection instance
 * @param navigations - Array to populate with navigation events
 * @returns Object with cleanup function and getCurrentNavigationId getter
 *
 * @remarks
 * - Only tracks main frame navigations (ignores iframe navigations)
 * - Navigation ID starts at 0 and increments with each navigation
 * - Initial page load counts as navigation 0
 *
 * @example
 * ```typescript
 * const navs: NavigationEvent[] = [];
 * const { cleanup, getCurrentNavigationId } = await startNavigationTracking(cdp, navs);
 *
 * // Later, validate if a reference is stale:
 * const currentNavId = getCurrentNavigationId();
 * if (referenceNavId !== currentNavId) {
 *   throw new Error('Stale reference - page has navigated');
 * }
 *
 * cleanup();
 * ```
 */
export async function startNavigationTracking(
  cdp: CDPConnection,
  navigations: NavigationEvent[]
): Promise<{ cleanup: CleanupFunction; getCurrentNavigationId: () => number }> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);
  let navigationCounter = 0;

  await cdp.send('Page.enable');

  const initialNavigation: NavigationEvent = {
    url: '',
    timestamp: Date.now(),
    navigationId: navigationCounter,
  };
  navigations.push(initialNavigation);

  registry.registerTyped(typed, 'Page.frameNavigated', (params) => {
    if (params.frame.parentId === undefined) {
      navigationCounter++;

      const navigation: NavigationEvent = {
        url: params.frame.url,
        timestamp: Date.now(),
        navigationId: navigationCounter,
      };

      navigations.push(navigation);

      log.debug(`Main frame navigation detected [${navigationCounter}]: ${params.frame.url}`);
    }
  });

  return {
    cleanup: () => {
      registry.cleanup();
    },
    getCurrentNavigationId: () => navigationCounter,
  };
}
