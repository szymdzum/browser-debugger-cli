import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
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
 * Parameters for the Page.frameNavigated event.
 */
interface CDPFrameNavigatedParams {
  /** Frame information */
  frame: {
    /** Frame ID */
    id: string;
    /** Parent frame ID (undefined for main frame) */
    parentId?: string;
    /** Frame URL */
    url: string;
    /** Frame name */
    name?: string;
  };
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
  let navigationCounter = 0;

  // Enable Page domain to receive navigation events
  await cdp.send('Page.enable');

  // Record initial navigation (the page we're currently on)
  const initialNavigation: NavigationEvent = {
    url: '', // Will be updated by first frameNavigated event or from session metadata
    timestamp: Date.now(),
    navigationId: navigationCounter,
  };
  navigations.push(initialNavigation);

  // Listen for frame navigation events
  registry.register<CDPFrameNavigatedParams>(
    cdp,
    'Page.frameNavigated',
    (params: CDPFrameNavigatedParams) => {
      // Only track main frame navigations (parentId is undefined for main frame)
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
    }
  );

  // Return cleanup function and navigation ID getter
  return {
    cleanup: () => {
      registry.cleanup(cdp);
    },
    getCurrentNavigationId: () => navigationCounter,
  };
}
