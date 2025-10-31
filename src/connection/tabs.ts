import { CDPConnection } from './cdp.js';
import {
  CDPTarget,
  CDPCreateTargetResponse,
  CDPAttachToTargetResponse,
  CDPGetTargetsResponse,
  CDPNavigateResponse,
} from '../types.js';
import { normalizeUrl } from '../utils/url.js';

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
    if (
      tabUrlObj.host === searchUrlObj.host &&
      tabUrlObj.pathname === searchUrlObj.pathname
    ) {
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
 * @param url - Target URL to find (will be normalized)
 * @param targets - List of available targets
 * @returns Best matching target or null if no match found
 */
export function findBestTarget(
  url: string,
  targets: CDPTarget[]
): CDPTarget | null {
  const searchUrl = normalizeUrl(url);

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
  if (
    scored.length > 1 &&
    scored[0].score === scored[1].score &&
    scored[0].score < 100
  ) {
    console.error(
      `Warning: Multiple tabs match equally (score ${scored[0].score}), using: ${scored[0].target.url}`
    );
  }

  return scored[0].target;
}

/**
 * Create a new tab with the specified URL using CDP.
 *
 * @param url - URL to open in the new tab
 * @param cdp - CDP connection instance
 * @returns Target information for the new tab
 */
export async function createNewTab(
  url: string,
  cdp: CDPConnection
): Promise<CDPTarget> {
  const normalizedUrl = normalizeUrl(url);
  const port = cdp.getPort();

  // Try CDP method first
  try {
    const response: CDPCreateTargetResponse = await cdp.send('Target.createTarget', {
      url: normalizedUrl,
      newWindow: false, // Open as tab, not window
    });

    // Fetch target info from Chrome
    const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets: CDPTarget[] = await listResponse.json();

    // Find the target we just created
    const target = targets.find((t) => t.id === response.targetId);

    if (target) {
      return target;
    }
  } catch (cdpError) {
    console.error(`CDP Target.createTarget failed, trying HTTP endpoint...`);
  }

  // Fallback to HTTP endpoint method
  try {
    const createResponse = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(normalizedUrl)}`
    );

    if (!createResponse.ok) {
      throw new Error(`HTTP /json/new failed: ${createResponse.statusText}`);
    }

    const target: CDPTarget = await createResponse.json();
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
 * @param url - URL to navigate to
 * @param cdp - CDP connection instance
 */
export async function navigateToUrl(
  targetId: string,
  url: string,
  cdp: CDPConnection
): Promise<void> {
  const normalizedUrl = normalizeUrl(url);

  // Attach to target
  const sessionResponse: CDPAttachToTargetResponse = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });

  // Navigate
  const navResponse: CDPNavigateResponse = await cdp.send(
    'Page.navigate',
    { url: normalizedUrl },
    sessionResponse.sessionId
  );

  if (navResponse.errorText) {
    throw new Error(`Navigation failed: ${navResponse.errorText}`);
  }
}

/**
 * Wait for a target to be ready (URL matches expected).
 *
 * @param targetId - CDP target ID to wait for
 * @param expectedUrl - Expected URL (normalized)
 * @param cdp - CDP connection instance
 * @param maxWaitMs - Maximum time to wait in milliseconds
 */
export async function waitForTargetReady(
  targetId: string,
  expectedUrl: string,
  cdp: CDPConnection,
  maxWaitMs = 15000
): Promise<void> {
  const startTime = Date.now();
  const normalizedUrl = normalizeUrl(expectedUrl);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Fetch current targets
      const response = await fetch(
        `http://127.0.0.1:${cdp.getPort()}/json/list`
      );
      const targets: CDPTarget[] = await response.json();

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
 * @param url - Target URL
 * @param cdp - CDP connection instance
 * @param reuseTab - If true, navigate existing tab instead of creating new one
 * @returns Target information
 */
export async function createOrFindTarget(
  url: string,
  cdp: CDPConnection,
  reuseTab = false
): Promise<CDPTarget> {
  // Only look for existing tabs if reuseTab is true
  if (reuseTab) {
    // Try to find existing target via CDP
    const targetsResponse: CDPGetTargetsResponse = await cdp.send('Target.getTargets');
    const targets: CDPTarget[] = targetsResponse.targetInfos.map((info) => ({
      id: info.targetId,
      type: info.type,
      url: info.url,
      title: info.title,
      webSocketDebuggerUrl: '', // Not needed for this operation
    }));

    const existingTarget = findBestTarget(url, targets);

    if (existingTarget) {
      console.error(`Found existing tab: ${existingTarget.url}`);

      // If URLs don't match exactly, navigate
      if (existingTarget.url !== normalizeUrl(url)) {
        console.error(`Navigating tab to: ${url}`);
        await navigateToUrl(existingTarget.id, url, cdp);
        await waitForTargetReady(existingTarget.id, url, cdp);
      }

      return existingTarget;
    }
  }

  // No matching tab found (or reuseTab=false), create new one
  console.error(`Creating new tab for: ${url}`);
  const newTarget = await createNewTab(url, cdp);

  // Wait for tab to start loading
  await waitForTargetReady(newTarget.id, url, cdp);

  return newTarget;
}
