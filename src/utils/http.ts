import { DEFAULT_CDP_PORT, HTTP_LOCALHOST } from '@/constants.js';
import type { CDPTarget } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('http');

/**
 * Timeout for CDP HTTP requests in milliseconds.
 *
 * Chrome's HTTP API should respond quickly when running.
 * A 5-second timeout helps detect when Chrome is not responding.
 */
const CDP_HTTP_TIMEOUT_MS = 5000;

/**
 * Fetch CDP targets from Chrome's HTTP API.
 *
 * Uses centralized constants for host and default port to ensure consistency
 * across all CDP target operations. This replaces duplicate HTTP endpoint logic
 * scattered across the codebase.
 *
 * @param port - Chrome debugging port (defaults to centralized DEFAULT_CDP_PORT)
 * @returns Promise resolving to array of CDP targets, or empty array on error
 *
 * @remarks
 * - Uses HTTP_LOCALHOST constant for consistent host addressing
 * - Returns empty array on HTTP errors, but logs details for debugging
 * - 5-second timeout prevents hanging when Chrome is unreachable
 * - Network errors are logged to help diagnose Chrome connectivity issues
 */
export async function fetchCDPTargets(port: number = DEFAULT_CDP_PORT): Promise<CDPTarget[]> {
  const url = `http://${HTTP_LOCALHOST}:${port}/json/list`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CDP_HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        log.debug(`CDP HTTP request failed: ${response.status} ${response.statusText} (${url})`);
        return [];
      }

      return (await response.json()) as CDPTarget[];
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        log.debug(`CDP HTTP request timeout after ${CDP_HTTP_TIMEOUT_MS}ms (${url})`);
      } else {
        log.debug(`CDP HTTP request error: ${error.message} (${url})`);
      }
    }
    return [];
  }
}

/**
 * Fetch specific CDP target by ID from Chrome's HTTP API.
 *
 * Convenience wrapper around fetchCDPTargets that filters for a specific target ID.
 * Uses centralized constants and shared HTTP logic for consistency.
 *
 * @param targetId - Target ID to search for
 * @param port - Chrome debugging port (defaults to centralized DEFAULT_CDP_PORT)
 * @returns Promise resolving to matching target, or null if not found/error
 *
 * @remarks
 * - Returns null rather than throwing on errors for easier consumption
 * - Searches all targets returned by Chrome's /json/list endpoint
 * - Uses shared fetchCDPTargets helper to avoid code duplication
 * - Inherits timeout and error logging from fetchCDPTargets
 */
export async function fetchCDPTargetById(
  targetId: string,
  port: number = DEFAULT_CDP_PORT
): Promise<CDPTarget | null> {
  const targets = await fetchCDPTargets(port);
  return targets.find((t) => t.id === targetId) ?? null;
}
