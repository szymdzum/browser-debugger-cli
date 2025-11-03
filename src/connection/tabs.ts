import type { CDPConnection } from '@/connection/cdp.js';
import {
  PAGE_TARGET_TYPE,
  BLANK_PAGE_URL,
  CDP_NEW_WINDOW_FLAG,
  CDP_FLATTEN_SESSION_FLAG,
  HTTP_LOCALHOST,
  DEFAULT_TARGET_READY_TIMEOUT_MS,
  TARGET_READY_POLL_INTERVAL_MS,
  LOADING_PAGE_ADDITIONAL_WAIT_MS,
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  VERIFICATION_INITIAL_DELAY_MS,
  VERIFICATION_MAX_DELAY_MS,
  VERIFICATION_BACKOFF_MULTIPLIER,
  DEFAULT_REUSE_TAB,
} from '@/constants';
import type { CDPTarget } from '@/types';
import type {
  CDPCreateTargetResponse,
  CDPAttachToTargetResponse,
  CDPGetTargetsResponse,
  CDPNavigateResponse,
} from '@/types';
import type { TabCreationResult } from '@/types';
import { fetchCDPTargetById } from '@/utils/http.js';
import { normalizeUrl } from '@/utils/url.js';

// Tab Matching Score Thresholds
const EXACT_URL_MATCH_SCORE = 100;
const HOST_AND_PATH_MATCH_SCORE = 90;
const HOST_AND_PATH_PREFIX_MATCH_SCORE = 70;
const HOST_ONLY_MATCH_SCORE = 50;
const SUBSTRING_MATCH_SCORE = 30;
const NO_MATCH_SCORE = 0;

// Message Templates
const MULTIPLE_TABS_WARNING_TEMPLATE = (score: number, url: string): string =>
  `Warning: Multiple tabs match equally (score ${score}), using: ${url}`;
const FOUND_EXISTING_TAB_MESSAGE = (url: string): string => `Found existing tab: ${url}`;
const NAVIGATING_TAB_MESSAGE = (url: string): string => `Navigating tab to: ${url}`;
const CREATING_NEW_TAB_MESSAGE = (url: string): string => `Creating new tab for: ${url}`;

// Error Messages
const CDP_CREATE_TARGET_FALLBACK_MESSAGE =
  'CDP Target.createTarget failed, attempting HTTP fallback...';

const HTTP_NEW_TAB_FAILED_ERROR = (statusText: string): string =>
  `HTTP /json/new failed: ${statusText}`;
const FAILED_TO_CREATE_TAB_ERROR = (details: string): string =>
  `Failed to create new tab: ${details}`;
const NAVIGATION_FAILED_ERROR = (errorText: string): string => `Navigation failed: ${errorText}`;
const TARGET_NOT_READY_ERROR = (timeoutMs: number): string =>
  `Target did not become ready within ${timeoutMs}ms`;

// Environment variable for timeout override with validation
/**
 * Parse and validate the BDG_TARGET_VERIFY_TIMEOUT environment variable.
 *
 * Converts string environment variable to number with validation and fallback.
 * Invalid values (non-numeric, negative, zero) fall back to the default timeout.
 *
 * @param envValue - Raw environment variable value (may be undefined)
 * @returns Parsed timeout in milliseconds, or DEFAULT_VERIFICATION_TIMEOUT_MS if invalid
 *
 * @remarks
 * - Accepts positive integers only
 * - Logs warning for invalid values before falling back
 * - Used to override default verification timeout via environment configuration
 */
const parseVerificationTimeout = (envValue: string | undefined): number => {
  if (!envValue) {
    return DEFAULT_VERIFICATION_TIMEOUT_MS;
  }

  const parsed = parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(
      `Invalid BDG_TARGET_VERIFY_TIMEOUT value: "${envValue}". Must be a positive number. Using default: ${DEFAULT_VERIFICATION_TIMEOUT_MS}ms`
    );
    return DEFAULT_VERIFICATION_TIMEOUT_MS;
  }

  return parsed;
};

const VERIFICATION_TIMEOUT_OVERRIDE = parseVerificationTimeout(
  process.env['BDG_TARGET_VERIFY_TIMEOUT']
);

// Strategy Names
const CDP_STRATEGY = 'CDP' as const;
const HTTP_STRATEGY = 'HTTP' as const;

// Error Types
const CDP_COMMAND_FAILED = 'CDP_COMMAND_FAILED' as const;

const VERIFICATION_TIMEOUT_ERROR_TYPE = 'VERIFICATION_TIMEOUT' as const;
const HTTP_REQUEST_FAILED = 'HTTP_REQUEST_FAILED' as const;

// Enhanced Error Messages
const VERIFICATION_TIMEOUT_ERROR = (
  targetId: string,
  timeoutMs: number,
  attempts: number
): string =>
  `Chrome acknowledged Target.createTarget (ID: ${targetId}) but target verification timed out after ${timeoutMs}ms (${attempts} attempts). The tab was created successfully but is not yet visible in Chrome's target list. This commonly occurs in headless/managed Chrome environments where target registration can take 1-5 seconds. Increase timeout with BDG_TARGET_VERIFY_TIMEOUT environment variable (e.g., BDG_TARGET_VERIFY_TIMEOUT=10000 for 10 seconds).`;

/**
 * Scored tab match result.
 */
interface ScoredTarget {
  target: CDPTarget;
  score: number;
}

/**
 * Score how well a tab matches the search URL.
 *
 * Uses a weighted scoring system where exact matches score highest (100),
 * followed by host+path matches (90), then host-only matches (50).
 * This prioritization ensures users get the most specific match first,
 * while still finding reasonable alternatives when exact matches don't exist.
 *
 * Fallback to substring matching (30) handles cases where URL parsing fails
 * due to malformed URLs or non-standard protocols.
 *
 * @param tab - Target to score
 * @param searchUrl - Normalized URL to match against
 * @returns Match score (0-100, higher = better match)
 */
function scoreTabMatch(tab: CDPTarget, searchUrl: string): number {
  if (tab.url === searchUrl) {
    return EXACT_URL_MATCH_SCORE;
  }

  try {
    const currentTabUrl = new URL(tab.url);
    const targetUrl = new URL(searchUrl);

    if (currentTabUrl.host === targetUrl.host && currentTabUrl.pathname === targetUrl.pathname) {
      return HOST_AND_PATH_MATCH_SCORE;
    }

    if (
      currentTabUrl.host === targetUrl.host &&
      currentTabUrl.pathname.startsWith(targetUrl.pathname)
    ) {
      return HOST_AND_PATH_PREFIX_MATCH_SCORE;
    }

    if (currentTabUrl.host === targetUrl.host) {
      return HOST_ONLY_MATCH_SCORE;
    }
  } catch {
    // URL parsing failed - fall back to substring matching
  }

  if (tab.url.includes(searchUrl)) {
    return SUBSTRING_MATCH_SCORE;
  }

  return NO_MATCH_SCORE;
}

/**
 * Find the best matching target from a list of tabs.
 *
 * Filters to page-type targets only because other target types (extensions,
 * service workers, etc.) cannot be navigated to user URLs. The scoring
 * system handles ambiguous matches by warning users when multiple tabs
 * have identical non-perfect scores, helping debug URL matching issues.
 *
 * @param normalizedUrl - Target URL to find (must be pre-normalized)
 * @param targets - List of available targets
 * @returns Best matching target or null if no match found
 */
export function findBestTarget(normalizedUrl: string, targets: CDPTarget[]): CDPTarget | null {
  const searchUrl = normalizedUrl;

  const pageTargets = targets.filter((target) => target.type === PAGE_TARGET_TYPE);

  if (pageTargets.length === 0) {
    return null;
  }

  const scored: ScoredTarget[] = pageTargets
    .map((target) => ({ target, score: scoreTabMatch(target, searchUrl) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return null;
  }

  const bestMatch = scored[0];
  const secondBestMatch = scored[1];
  if (
    scored.length > 1 &&
    bestMatch &&
    secondBestMatch &&
    bestMatch.score === secondBestMatch.score &&
    bestMatch.score < 100
  ) {
    console.error(MULTIPLE_TABS_WARNING_TEMPLATE(bestMatch.score, bestMatch.target.url));
  }

  return bestMatch ? bestMatch.target : null;
}

/**
 * Verify target exists with configurable timeout and exponential backoff.
 *
 * Uses a timeout-based approach rather than fixed attempt count to better
 * handle variable Chrome registration delays in enterprise/headless environments.
 * Logs timing information for debugging verification issues.
 */
async function verifyTargetWithBackoff(
  targetId: string,
  port: number,
  timeoutMs: number = VERIFICATION_TIMEOUT_OVERRIDE
): Promise<{ target: CDPTarget }> {
  const startTime = Date.now();
  let attemptCount = 0;
  let currentDelayMs = VERIFICATION_INITIAL_DELAY_MS;

  while (Date.now() - startTime < timeoutMs) {
    attemptCount++;

    try {
      const target = await fetchCDPTargetById(targetId, port);

      if (target) {
        const totalDuration = Date.now() - startTime;
        console.error(
          `Target verification succeeded: ${targetId} (${totalDuration}ms, ${attemptCount} attempts)`
        );
        return { target };
      }

      const remainingTimeMs = timeoutMs - (Date.now() - startTime);
      if (remainingTimeMs <= currentDelayMs) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelayMs));
      currentDelayMs = Math.min(
        currentDelayMs * VERIFICATION_BACKOFF_MULTIPLIER,
        VERIFICATION_MAX_DELAY_MS
      );
    } catch {
      const remainingTimeMs = timeoutMs - (Date.now() - startTime);
      if (remainingTimeMs <= currentDelayMs) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelayMs));
      currentDelayMs = Math.min(
        currentDelayMs * VERIFICATION_BACKOFF_MULTIPLIER,
        VERIFICATION_MAX_DELAY_MS
      );
    }
  }

  const totalDuration = Date.now() - startTime;

  console.error(`Target verification timeout: ${targetId}`, {
    duration: totalDuration,
    attempts: attemptCount,
    timeout: timeoutMs,
  });

  throw new Error(VERIFICATION_TIMEOUT_ERROR(targetId, timeoutMs, attemptCount));
}

/**
 * Attempt tab creation via CDP with enhanced verification.
 *
 * Distinguishes between CDP command failures (should trigger HTTP fallback)
 * and verification timeouts (should fail without fallback to prevent duplicate tabs).
 *
 * Uses configurable timeout to handle Chrome registration delays in
 * enterprise/headless environments where targets take 0.5-5s to appear.
 */
async function attemptCDPCreation(
  normalizedUrl: string,
  cdp: CDPConnection
): Promise<TabCreationResult> {
  const startTime = Date.now();
  let cdpResponse: CDPCreateTargetResponse;

  try {
    cdpResponse = (await cdp.send('Target.createTarget', {
      url: normalizedUrl,
      newWindow: CDP_NEW_WINDOW_FLAG,
    })) as CDPCreateTargetResponse;
  } catch (error) {
    return {
      success: false,
      error: {
        type: CDP_COMMAND_FAILED,
        message: error instanceof Error ? error.message : String(error),
        originalError: error,
        context: {
          stage: 'cdp_command',
        },
      },
      strategy: CDP_STRATEGY,
      timing: {
        attemptStartMs: startTime,
        durationMs: Date.now() - startTime,
      },
    };
  }

  try {
    const { target } = await verifyTargetWithBackoff(
      cdpResponse.targetId,
      cdp.getPort(),
      VERIFICATION_TIMEOUT_OVERRIDE
    );

    return {
      success: true,
      target,
      strategy: CDP_STRATEGY,
      timing: {
        attemptStartMs: startTime,
        durationMs: Date.now() - startTime,
      },
    };
  } catch (verificationError) {
    return {
      success: false,
      error: {
        type: VERIFICATION_TIMEOUT_ERROR_TYPE,
        message:
          verificationError instanceof Error
            ? verificationError.message
            : String(verificationError),
        originalError: verificationError,
        context: {
          targetId: cdpResponse.targetId,
          stage: 'verification',
        },
      },
      strategy: CDP_STRATEGY,
      timing: {
        attemptStartMs: startTime,
        durationMs: Date.now() - startTime,
      },
    };
  }
}

/**
 * Attempt tab creation via HTTP endpoint.
 *
 * Uses Chrome's /json/new HTTP endpoint as a fallback when CDP fails.
 * This endpoint is more forgiving on Chrome instances with restricted
 * Target domain access (e.g., remote-debugging with atypical flags).
 * The HTTP handler waits for tab readiness before responding.
 */
async function attemptHTTPCreation(
  normalizedUrl: string,
  port: number
): Promise<TabCreationResult> {
  const startTime = Date.now();

  try {
    const createResponse = await fetch(
      `http://${HTTP_LOCALHOST}:${port}/json/new?${encodeURIComponent(normalizedUrl)}`
    );

    if (!createResponse.ok) {
      throw new Error(HTTP_NEW_TAB_FAILED_ERROR(createResponse.statusText));
    }

    const target = (await createResponse.json()) as CDPTarget;

    return {
      success: true,
      target,
      strategy: HTTP_STRATEGY,
      timing: {
        attemptStartMs: startTime,
        durationMs: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: HTTP_REQUEST_FAILED,
        message: error instanceof Error ? error.message : String(error),
        originalError: error,
        context: {
          ...(error instanceof Error &&
          'status' in error &&
          (error as { status?: number }).status !== undefined
            ? { httpStatus: (error as { status?: number }).status }
            : {}),
        },
      },
      strategy: HTTP_STRATEGY,
      timing: {
        attemptStartMs: startTime,
        durationMs: Date.now() - startTime,
      },
    };
  }
}

/**
 * Create a new tab with the specified URL using CDP.
 *
 * Uses a two-phase approach with enhanced error handling:
 * - CDP command failures → HTTP fallback (prevents total failure)
 * - Verification timeouts → Fail fast with targeted error (prevents duplicate tabs)
 *
 * Configurable verification timeout via BDG_TARGET_VERIFY_TIMEOUT environment
 * variable to handle slow Chrome registration in enterprise/headless environments.
 *
 * @param normalizedUrl - URL to open in the new tab (must be pre-normalized)
 * @param cdp - CDP connection instance
 * @returns Target information for the new tab
 * @throws Error if tab creation fails or verification times out
 */
export async function createNewTab(normalizedUrl: string, cdp: CDPConnection): Promise<CDPTarget> {
  const cdpPort = cdp.getPort();

  // Primary strategy: CDP creation with enhanced verification
  const cdpCreationResult = await attemptCDPCreation(normalizedUrl, cdp);

  if (cdpCreationResult.success && cdpCreationResult.target) {
    return cdpCreationResult.target;
  }

  if (cdpCreationResult.error?.type === VERIFICATION_TIMEOUT_ERROR_TYPE) {
    throw new Error(cdpCreationResult.error.message);
  }

  console.error(CDP_CREATE_TARGET_FALLBACK_MESSAGE, {
    strategy: cdpCreationResult.strategy,
    errorType: cdpCreationResult.error?.type,
    stage: cdpCreationResult.error?.context?.stage,
    duration: cdpCreationResult.timing.durationMs,
    error: cdpCreationResult.error?.message,
  });

  // Fallback strategy: HTTP creation
  const httpCreationResult = await attemptHTTPCreation(normalizedUrl, cdpPort);

  if (httpCreationResult.success && httpCreationResult.target) {
    return httpCreationResult.target;
  }

  throw new Error(
    FAILED_TO_CREATE_TAB_ERROR(
      `CDP command failed (${cdpCreationResult.error?.message}), HTTP fallback also failed (${httpCreationResult.error?.message})`
    )
  );
}

/**
 * Fetch a specific target by ID from Chrome's target list.
 *
 * Encapsulates the HTTP fetch and JSON parsing logic with error handling.
 * Returns null when the target is not found or fetch fails, allowing
 * the caller to decide on retry logic.
 */
async function fetchTargetById(targetId: string, port: number): Promise<CDPTarget | null> {
  return fetchCDPTargetById(targetId, port);
}

/**
 * Check if a target is ready for interaction.
 *
 * A target is considered ready when its URL matches the expected URL
 * or shows a valid intermediate state. The about:blank check handles
 * the common case where Chrome shows a blank page during navigation.
 */
function isTargetReady(target: CDPTarget, expectedUrl: string): boolean {
  return (
    target.url === expectedUrl ||
    target.url.startsWith(expectedUrl) ||
    target.url === BLANK_PAGE_URL
  );
}

/**
 * Handle the special case of about:blank pages during navigation.
 *
 * Chrome often shows about:blank briefly before loading the actual URL.
 * This delay allows the navigation to progress before checking again.
 * Returns true if additional waiting is needed, false if ready to proceed.
 */
async function handleBlankPageDelay(target: CDPTarget): Promise<boolean> {
  if (target.url === BLANK_PAGE_URL) {
    await new Promise((resolve) => setTimeout(resolve, LOADING_PAGE_ADDITIONAL_WAIT_MS));
    return true; // Need to continue waiting
  }
  return false; // Ready to proceed
}

/**
 * Navigate an existing tab to a new URL using CDP.
 *
 * Requires attaching to the target first because Page.navigate commands
 * must be sent within a target session context. The flatten:true option
 * simplifies session management by avoiding nested session hierarchies
 * that can complicate cleanup and event handling.
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
  const sessionResponse = (await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: CDP_FLATTEN_SESSION_FLAG,
  })) as CDPAttachToTargetResponse;

  const navResponse = (await cdp.send(
    'Page.navigate',
    { url: normalizedUrl },
    sessionResponse.sessionId
  )) as CDPNavigateResponse;

  if (navResponse.errorText) {
    throw new Error(NAVIGATION_FAILED_ERROR(navResponse.errorText));
  }
}

/**
 * Wait for a target to be ready (URL matches expected).
 *
 * Polling is necessary because tab navigation is asynchronous and Chrome
 * may report intermediate states (like about:blank) before the final URL
 * loads. The 500ms additional wait for about:blank handles the common case
 * where Chrome briefly shows a blank page before starting navigation.
 *
 * Uses HTTP endpoint instead of CDP for target status because the HTTP
 * interface provides more reliable target state information during
 * navigation transitions.
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
  maxWaitMs = DEFAULT_TARGET_READY_TIMEOUT_MS
): Promise<void> {
  const pollingStartTime = Date.now();
  const cdpPort = cdp.getPort();

  while (Date.now() - pollingStartTime < maxWaitMs) {
    const currentTarget = await fetchTargetById(targetId, cdpPort);

    if (!currentTarget) {
      await new Promise((resolve) => setTimeout(resolve, TARGET_READY_POLL_INTERVAL_MS));
      continue;
    }

    if (!isTargetReady(currentTarget, normalizedUrl)) {
      await new Promise((resolve) => setTimeout(resolve, TARGET_READY_POLL_INTERVAL_MS));
      continue;
    }

    const needsMoreWaiting = await handleBlankPageDelay(currentTarget);
    if (needsMoreWaiting) {
      continue;
    }

    return;
  }

  throw new Error(TARGET_NOT_READY_ERROR(maxWaitMs));
}

/**
 * Retrieve all available targets from Chrome via CDP.
 *
 * Transforms CDP target info into the standard CDPTarget format
 * used throughout the pipeline. The webSocketDebuggerUrl is left
 * empty as it's not needed for target discovery operations.
 */
async function getExistingTargets(cdp: CDPConnection): Promise<CDPTarget[]> {
  const targetsResponse = (await cdp.send('Target.getTargets')) as CDPGetTargetsResponse;

  return targetsResponse.targetInfos.map((info) => ({
    id: info.targetId,
    type: info.type,
    url: info.url,
    title: info.title,
    webSocketDebuggerUrl: '',
  }));
}

/**
 * Navigate an existing target to the desired URL if needed.
 *
 * Only performs navigation when URLs don't match exactly, avoiding
 * unnecessary navigation operations that could disrupt page state.
 * Uses the same verification logic as new tab creation to ensure
 * the navigation completes successfully.
 */
async function navigateExistingTarget(
  target: CDPTarget,
  normalizedUrl: string,
  cdp: CDPConnection
): Promise<CDPTarget> {
  console.error(FOUND_EXISTING_TAB_MESSAGE(target.url));

  if (target.url !== normalizedUrl) {
    console.error(NAVIGATING_TAB_MESSAGE(normalizedUrl));
    await navigateToUrl(target.id, normalizedUrl, cdp);
    await waitForTargetReady(target.id, normalizedUrl, cdp);
  }

  return target;
}

/**
 * Find and optionally navigate to an existing target.
 *
 * Encapsulates the complete target reuse workflow: discovery,
 * matching, and navigation. Returns null when no suitable target
 * is found, allowing the caller to proceed with new tab creation.
 */
async function findAndReuseTarget(
  normalizedUrl: string,
  cdp: CDPConnection
): Promise<CDPTarget | null> {
  const existingTargets = await getExistingTargets(cdp);
  const matchingTarget = findBestTarget(normalizedUrl, existingTargets);

  if (!matchingTarget) {
    return null;
  }

  try {
    return await navigateExistingTarget(matchingTarget, normalizedUrl, cdp);
  } catch (error) {
    console.error(`Failed to reuse tab: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Create a new tab or find existing tab with the target URL.
 *
 * This is the main entry point for tab management with a clear workflow:
 * when reuseTab=true, attempts to find and navigate existing tabs to avoid
 * creating unnecessary browser tabs. When reuseTab=false or no suitable
 * tab exists, creates a new tab for isolated testing scenarios.
 *
 * URL normalization happens once at entry to ensure consistent matching
 * and navigation behavior throughout the entire workflow.
 *
 * @param url - Target URL (will be normalized once at entry)
 * @param cdp - CDP connection instance
 * @param reuseTab - If true, navigate existing tab instead of creating new one
 * @returns Target information
 */
export async function createOrFindTarget(
  url: string,
  cdp: CDPConnection,
  reuseTab = DEFAULT_REUSE_TAB
): Promise<CDPTarget> {
  const targetUrl = normalizeUrl(url);

  // Guard clause: Skip target reuse if not requested
  if (!reuseTab) {
    console.error(CREATING_NEW_TAB_MESSAGE(targetUrl));
    const newTarget = await createNewTab(targetUrl, cdp);
    await waitForTargetReady(newTarget.id, targetUrl, cdp);
    return newTarget;
  }

  // Attempt to find and reuse existing target
  const reusedTarget = await findAndReuseTarget(targetUrl, cdp);

  // Early return if target reuse succeeded
  if (reusedTarget) {
    return reusedTarget;
  }

  // Fallback: Create new tab when no suitable target found
  console.error(CREATING_NEW_TAB_MESSAGE(targetUrl));
  const newTarget = await createNewTab(targetUrl, cdp);
  await waitForTargetReady(newTarget.id, targetUrl, cdp);
  return newTarget;
}
