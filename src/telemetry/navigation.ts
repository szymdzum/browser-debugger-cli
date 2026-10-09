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
 * Resumed on the same tab (after a failed switch), its navigation goes on.
 * With `issued`, an id is never given twice, also after the events of a
 * failed switch were taken back.
 *
 * @param cdp - CDP connection instance
 * @param navigations - Array to populate with navigation events
 * @param tab - `tabUrl`: the page of a tab tracking moved to; `resume`: same
 *   tab, same navigation; `issued`: highest id given so far (shared by the
 *   trackers of one session, updated here)
 * @returns Cleanup function and counter getters
 */
export async function startNavigationTracking(
  cdp: CDPConnection,
  navigations: NavigationEvent[],
  tab: NavigationStart = {}
): Promise<NavigationTracker> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);
  const issued = tab.issued ?? { last: -1 };
  const resumed = tab.resume === true && navigations.length > 0;
  let navigationCounter = firstNavigationId(navigations, resumed, issued);
  const record = (url: string): void => {
    issued.last = Math.max(issued.last, navigationCounter);
    navigations.push({ url, timestamp: Date.now(), navigationId: navigationCounter });
  };

  await cdp.send('Page.enable');
  if (!resumed) record(tab.tabUrl ?? '');

  registry.registerTyped(typed, 'Page.frameNavigated', (params) => {
    if (params.frame.parentId !== undefined) return;
    navigationCounter++;
    record(params.frame.url);
    log.debug(`Main frame navigation detected [${navigationCounter}]: ${params.frame.url}`);
  });

  return {
    cleanup: () => {
      registry.cleanup();
    },
    getCurrentNavigationId: () => navigationCounter,
  };
}

/** How navigation tracking starts on a tab */
export interface NavigationStart {
  /** URL of the page of a tab tracking moved to */
  tabUrl?: string;
  /** Same tab, same navigation (after a failed switch) */
  resume?: boolean;
  /** Highest navigation id given so far in the session */
  issued?: { last: number };
}

/**
 * The navigation id a tracker starts with: the last one when it resumes,
 * else one past the highest given so far.
 *
 * @param navigations - Navigation events
 * @param resumed - Whether it resumes on the same tab
 * @param issued - Highest id given so far
 * @returns Id
 */
function firstNavigationId(
  navigations: NavigationEvent[],
  resumed: boolean,
  issued: { last: number }
): number {
  const last = navigations.at(-1)?.navigationId ?? -1;
  return resumed ? last : Math.max(last, issued.last) + 1;
}
