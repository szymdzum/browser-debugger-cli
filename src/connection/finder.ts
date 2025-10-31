import { CDPTarget } from '../types.js';

/**
 * Validate that a target still exists in Chrome.
 *
 * Used to detect when a tab has been closed during collection.
 *
 * @param targetId - CDP target ID to validate
 * @param port - Chrome debugging port
 * @returns True if target still exists, false otherwise
 */
export async function validateTarget(targetId: string, port = 9222): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) {
      return false;
    }
    const targets: CDPTarget[] = await response.json();
    return targets.some(t => t.id === targetId);
  } catch {
    return false;
  }
}
