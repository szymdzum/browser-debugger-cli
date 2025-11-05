import { DEFAULT_CDP_PORT, HTTP_LOCALHOST } from '@/constants.js';
import type { CDPTarget } from '@/types';

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
 * - Returns empty array rather than throwing on HTTP errors for easier consumption
 * - Network errors are silently handled - callers should validate results
 */
export async function fetchCDPTargets(port: number = DEFAULT_CDP_PORT): Promise<CDPTarget[]> {
  try {
    const response = await fetch(`http://${HTTP_LOCALHOST}:${port}/json/list`);
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as CDPTarget[];
  } catch {
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
 */
export async function fetchCDPTargetById(
  targetId: string,
  port: number = DEFAULT_CDP_PORT
): Promise<CDPTarget | null> {
  const targets = await fetchCDPTargets(port);
  return targets.find((t) => t.id === targetId) ?? null;
}
