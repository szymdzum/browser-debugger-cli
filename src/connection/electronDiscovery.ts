/**
 * Electron app discovery via Chrome DevTools Protocol.
 *
 * Electron apps with --remote-debugging-port expose the same /json/list
 * endpoint as Chrome, allowing bdg to connect and control them.
 */

import type { CDPTarget } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { fetchCDPTargets } from '@/utils/http.js';

/** Default Electron CDP port (matches agent-monitor's configuration) */
export const DEFAULT_ELECTRON_PORT = 9229;

/** Electron target types in order of preference */
const PREFERRED_TARGET_TYPES = ['page', 'webview', 'background_page'];

/**
 * Discover available Electron targets on the specified port.
 *
 * @param port - CDP port (default: 9229)
 * @param logger - Optional logger for debug output
 * @returns Array of CDP targets from Electron
 */
export async function discoverElectronTargets(
  port: number = DEFAULT_ELECTRON_PORT,
  logger?: Logger
): Promise<CDPTarget[]> {
  return fetchCDPTargets(port, logger);
}

/**
 * Find the best Electron target to connect to.
 *
 * Prefers 'page' targets (BrowserWindow content), then 'webview',
 * then falls back to the first available target.
 *
 * @param port - CDP port (default: 9229)
 * @param targetId - Optional specific target ID to select
 * @param logger - Optional logger for debug output
 * @returns Best matching CDP target, or null if none found
 */
export async function findElectronTarget(
  port: number = DEFAULT_ELECTRON_PORT,
  targetId?: string,
  logger?: Logger
): Promise<CDPTarget | null> {
  const targets = await discoverElectronTargets(port, logger);

  if (targets.length === 0) {
    return null;
  }

  // If specific target requested, find it
  if (targetId) {
    return targets.find((t) => t.id === targetId) ?? null;
  }

  // Find best target by type preference
  for (const preferredType of PREFERRED_TARGET_TYPES) {
    const target = targets.find((t) => t.type === preferredType);
    if (target) {
      return target;
    }
  }

  // Fall back to first target
  return targets[0] ?? null;
}

/**
 * Get WebSocket URL for an Electron app.
 *
 * Convenience function that finds the best target and returns its WebSocket URL.
 *
 * @param port - CDP port (default: 9229)
 * @param targetId - Optional specific target ID
 * @param logger - Optional logger for debug output
 * @returns WebSocket debugger URL, or null if no targets found
 */
export async function getElectronWsUrl(
  port: number = DEFAULT_ELECTRON_PORT,
  targetId?: string,
  logger?: Logger
): Promise<string | null> {
  const target = await findElectronTarget(port, targetId, logger);
  return target?.webSocketDebuggerUrl ?? null;
}
