import { createOrFindTarget } from '@/connection/tabs.js';
import { BdgSession } from '@/session/BdgSession.js';
import type { CDPTarget, SessionOptions } from '@/types';

/**
 * Handles CDP target setup and session creation
 */
export class TargetSetup {
  /**
   * Create CDP connection and find/create target tab
   *
   * @param url - Original URL from CLI (for matching)
   * @param targetUrl - Normalized target URL
   * @param port - Chrome debugging port
   * @param reuseTab - Whether to reuse existing tab
   * @param sessionOptions - Session-level collection options
   * @returns Session and target metadata
   */
  static async setup(
    url: string,
    targetUrl: string,
    port: number,
    reuseTab: boolean,
    sessionOptions: SessionOptions = {}
  ): Promise<{ session: BdgSession; target: CDPTarget }> {
    // Fetch targets once
    const initialTargets = await this.fetchTargets(port);

    if (initialTargets.length === 0) {
      throw new Error('No targets available in Chrome');
    }

    // Use first available target to establish CDP connection
    const tempTarget = initialTargets[0];
    if (!tempTarget) {
      throw new Error('No targets available in Chrome');
    }
    const tempSession = new BdgSession(tempTarget, port, sessionOptions);
    await tempSession.connect();

    if (!tempSession.isConnected()) {
      throw new Error('Failed to establish CDP connection');
    }

    // Create or find target tab using TabManager
    console.error(`Finding or creating tab for: ${targetUrl}`);
    const target = await createOrFindTarget(url, tempSession.getCDP(), reuseTab);
    console.error(`Using tab: ${target.url}`);

    // Find full target metadata (refetches only if not in cache or new tab created)
    const fullTarget = await this.findTargetById(target.id, port, initialTargets);

    // Close temp session and reconnect to the correct target
    tempSession.getCDP().close();
    const session = new BdgSession(fullTarget, port, sessionOptions);
    await session.connect();

    return { session, target: fullTarget };
  }

  /**
   * Fetch the current list of available CDP targets from Chrome.
   * Used during session bootstrap to select a temporary connection target and to
   * refresh metadata when the session creates or reuses tabs.
   *
   * @param port - Chrome debugging port
   * @returns Array of CDP targets
   */
  private static async fetchTargets(port: number): Promise<CDPTarget[]> {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await response.json()) as CDPTarget[];
  }

  /**
   * Locate a specific CDP target by ID. Falls back to a fresh fetch when cached
   * metadata is missing or incomplete (e.g., webSocketDebuggerUrl absent).
   *
   * @param targetId - Target ID to find
   * @param port - Chrome debugging port
   * @param cachedTargets - Optional cached target list
   * @returns CDP target with webSocketDebuggerUrl
   * @throws Error if target not found or missing webSocketDebuggerUrl
   */
  private static async findTargetById(
    targetId: string,
    port: number,
    cachedTargets?: CDPTarget[]
  ): Promise<CDPTarget> {
    // First check cached targets if provided
    if (cachedTargets) {
      const cached = cachedTargets.find((t) => t.id === targetId);
      if (cached?.webSocketDebuggerUrl) {
        return cached;
      }
    }

    // Not in cache or missing webSocketDebuggerUrl - refetch
    const targets = await this.fetchTargets(port);
    const target = targets.find((t) => t.id === targetId);

    if (!target) {
      throw new Error(`Could not find target ${targetId}`);
    }

    if (!target.webSocketDebuggerUrl) {
      throw new Error(`Could not find webSocketDebuggerUrl for target ${targetId}`);
    }

    return target;
  }
}
