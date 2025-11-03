import { DEFAULT_CDP_PORT } from '@/constants';
import { fetchCDPTargets } from '@/utils/http.js';

/**
 * Validate that a CDP target still exists.
 *
 * This function polls Chrome's target list to verify the target hasn't been closed.
 * Used during long-running sessions to detect tab closures.
 *
 * @param targetId - Target ID to validate
 * @param port - Chrome debugging port (defaults to centralized DEFAULT_CDP_PORT)
 * @returns True if target still exists, false otherwise
 */
export async function validateTarget(targetId: string, port = DEFAULT_CDP_PORT): Promise<boolean> {
  const targets = await fetchCDPTargets(port);
  return targets.some((t) => t.id === targetId);
}
