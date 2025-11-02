import type { CDPConnection } from '@/connection/cdp.js';
import type { CDPTarget } from '@/types';
import type {
  CDPCreateTargetResponse,
  CDPAttachToTargetResponse,
  CDPGetTargetsResponse,
  CDPNavigateResponse,
} from '@/types';
import { normalizeUrl } from '@/utils/url.js';

/**
 * Scored tab match result.
 */
interface ScoredTarget {
  target: CDPTarget;
  score: number;
}

/**
 * Score how well a tab matches the search URL.
 * Higher score = better match.
 *
 * @param tab - Target to score
 * @param searchUrl - Normalized URL to match against
 * @returns Match score (0-100)
 */
function scoreTabMatch(tab: CDPTarget, searchUrl: string): number {
  // Exact match = best score
  if (tab.url === searchUrl) {
    return 100;
  }

  // Try URL-based matching
  try {
    const tabUrlObj = new URL(tab.url);
    const searchUrlObj = new URL(searchUrl);

    // Same host + path = excellent score
    if (tabUrlObj.host === searchUrlObj.host && tabUrlObj.pathname === searchUrlObj.pathname) {
      return 90;
    }

    // Same host + path prefix = good score
    if (
      tabUrlObj.host === searchUrlObj.host &&
      tabUrlObj.pathname.startsWith(searchUrlObj.pathname)
    ) {
      return 70;
    }

    // Same host = decent score
    if (tabUrlObj.host === searchUrlObj.host) {
      return 50;
    }
  } catch {
    // URL parsing failed, fall back to substring matching
  }

  // Substring match = weak score
  if (tab.url.includes(searchUrl)) {
    return 30;
  }

  return 0; // No match
}

/**
 * Find the best matching target from a list of tabs.
 *
 * @param normalizedUrl - Target URL to find (must be pre-normalized)
 * @param targets - List of available targets
 * @returns Best matching target or null if no match found
 */
export function findBestTarget(normalizedUrl: string, targets: CDPTarget[]): CDPTarget | null {
  const searchUrl = normalizedUrl;

  // Filter for page targets only
  const pageTargets = targets.filter((t) => t.type === 'page');

  if (pageTargets.length === 0) {
    return null;
  }

  // Score all targets
  const scored: ScoredTarget[] = pageTargets
    .map((t) => ({ target: t, score: scoreTabMatch(t, searchUrl) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return null;
  }

  // Warn if multiple tabs have same score
  const first = scored[0];
  const second = scored[1];
  if (scored.length > 1 && first && second && first.score === second.score && first.score < 100) {
    console.error(
      `Warning: Multiple tabs match equally (score ${first.score}), using: ${first.target.url}`
    );
  }

  return first ? first.target : null;
}

/**
 * Create a new tab with the specified URL using CDP.
 *
 * @param normalizedUrl - URL to open in the new tab (must be pre-normalized)
 * @param cdp - CDP connection instance
 * @returns Target information for the new tab
 * @throws Error if tab creation fails via both CDP and HTTP fallback methods
 */
export async function createNewTab(normalizedUrl: string, cdp: CDPConnection): Promise<CDPTarget> {
  const port = cdp.getPort();

  let createdTargetId: string | null = null;

  try {
    const response = (await cdp.send('Target.createTarget', {
      url: normalizedUrl,
      newWindow: false, // Open as tab, not window
    })) as CDPCreateTargetResponse;
    createdTargetId = response.targetId;
  } catch (error) {
    console.error('CDP Target.createTarget failed, attempting HTTP fallback...', error);
  }

  if (createdTargetId) {
    try {
      const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!listResponse.ok) {
        throw new Error(
          `Failed to list targets: ${listResponse.status} ${listResponse.statusText}`
        );
      }
      const targets = (await listResponse.json()) as CDPTarget[];
      const target = targets.find((t) => t.id === createdTargetId);

      if (!target) {
        throw new Error(`Created target ${createdTargetId} not found in Chrome target list`);
      }

      return target;
    } catch (resolveError) {
      throw new Error(
        `Failed to resolve created tab: ${
          resolveError instanceof Error ? resolveError.message : String(resolveError)
        }`
      );
    }
  }

  // Fallback to HTTP endpoint method
  try {
    const createResponse = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(normalizedUrl)}`
    );

    if (!createResponse.ok) {
      throw new Error(`HTTP /json/new failed: ${createResponse.statusText}`);
    }

    const target = (await createResponse.json()) as CDPTarget;
    return target;
  } catch (httpError) {
    throw new Error(
      `Failed to create new tab: ${httpError instanceof Error ? httpError.message : String(httpError)}`
    );
  }
}

/**
 * Navigate an existing tab to a new URL using CDP.
 *
 * @param targetId - CDP target ID to navigate
 * @param normalizedUrl - URL to navigate to (must be pre-normalized)
 * @param cdp - CDP connection instance
 * @throws Error if navigation fails (e.g., network error, invalid URL, blocked by browser)
 */
export async function navigateToUrl(
  targetId: string,
  normalizedUrl: string,
  cdp: CDPConnection
): Promise<void> {
  // Attach to target
  const sessionResponse = (await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })) as CDPAttachToTargetResponse;

  // Navigate
  const navResponse = (await cdp.send(
    'Page.navigate',
    { url: normalizedUrl },
    sessionResponse.sessionId
  )) as CDPNavigateResponse;

  if (navResponse.errorText) {
    throw new Error(`Navigation failed: ${navResponse.errorText}`);
  }
}

/**
 * Wait for a target to be ready (URL matches expected).
 *
 * @param targetId - CDP target ID to wait for
 * @param normalizedUrl - Expected URL (must be pre-normalized)
 * @param cdp - CDP connection instance
 * @param maxWaitMs - Maximum time to wait in milliseconds
 * @throws Error if target doesn't become ready within maxWaitMs timeout
 */
export async function waitForTargetReady(
  targetId: string,
  normalizedUrl: string,
  cdp: CDPConnection,
  maxWaitMs = 15000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Fetch current targets
      const response = await fetch(`http://127.0.0.1:${cdp.getPort()}/json/list`);
      const targets = (await response.json()) as CDPTarget[];

      const target = targets.find((t) => t.id === targetId);

      if (target) {
        // Check if URL matches or is loading
        if (
          target.url === normalizedUrl ||
          target.url.startsWith(normalizedUrl) ||
          target.url === 'about:blank' // Still loading
        ) {
          // Wait a bit more if still on about:blank
          if (target.url === 'about:blank') {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          return; // Target is ready!
        }
      }
    } catch {
      // Target doesn't exist yet or fetch failed, keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Target did not become ready within ${maxWaitMs}ms`);
}

/**
 * Create a new tab or find existing tab with the target URL.
 *
 * This is the main entry point for tab management.
 * It tries to find an existing tab first, and if not found,
 * creates a new one.
 *
 * @param url - Target URL (will be normalized once at entry)
 * @param cdp - CDP connection instance
 * @param reuseTab - If true, navigate existing tab instead of creating new one
 * @returns Target information
 */
export async function createOrFindTarget(
  url: string,
  cdp: CDPConnection,
  reuseTab = false
): Promise<CDPTarget> {
  // Normalize URL once at entry point
  const normalizedUrl = normalizeUrl(url);

  // Only look for existing tabs if reuseTab is true
  if (reuseTab) {
    // Try to find existing target via CDP
    const targetsResponse = (await cdp.send('Target.getTargets')) as CDPGetTargetsResponse;
    const targets: CDPTarget[] = targetsResponse.targetInfos.map((info) => ({
      id: info.targetId,
      type: info.type,
      url: info.url,
      title: info.title,
      webSocketDebuggerUrl: '', // Not needed for this operation
    }));

    const existingTarget = findBestTarget(normalizedUrl, targets);

    if (existingTarget) {
      console.error(`Found existing tab: ${existingTarget.url}`);

      // If URLs don't match exactly, navigate
      if (existingTarget.url !== normalizedUrl) {
        console.error(`Navigating tab to: ${normalizedUrl}`);
        await navigateToUrl(existingTarget.id, normalizedUrl, cdp);
        await waitForTargetReady(existingTarget.id, normalizedUrl, cdp);
      }

      return existingTarget;
    }
  }

  // No matching tab found (or reuseTab=false), create new one
  console.error(`Creating new tab for: ${normalizedUrl}`);
  const newTarget = await createNewTab(normalizedUrl, cdp);

  // Wait for tab to start loading
  await waitForTargetReady(newTarget.id, normalizedUrl, cdp);

  return newTarget;
}
