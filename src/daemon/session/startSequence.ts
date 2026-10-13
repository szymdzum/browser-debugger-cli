/**
 * The order of a session start and of its teardown, defined once: each step
 * registers its release on the session's {@link ResourceStack} right after it
 * acquires, so disposing the stack releases exactly what was acquired, last
 * first.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { CleanupFunction, LaunchedChrome } from '@/types.js';
import type { ResourceStack } from '@/utils/resourceStack.js';

/**
 * What a session start does; the session supplies the real operations,
 * tests fakes. Every step gets the session's stop signal.
 */
export interface StartOperations {
  /** Launch Chrome, or attach to the user's (null) */
  launchChrome(signal: AbortSignal): Promise<LaunchedChrome | null>;
  /** Find the page target of a launched Chrome */
  findPageTarget(signal: AbortSignal): Promise<void>;
  /** Connect to the page */
  connect(signal: AbortSignal): Promise<CDPConnection>;
  /** Restore `--state` before the first navigation */
  restoreState(cdp: CDPConnection, signal: AbortSignal): Promise<void>;
  /** Apply the session's emulation */
  applyEmulation(cdp: CDPConnection, signal: AbortSignal): Promise<void>;
  /** Start the collectors that run once for the session */
  startCollectors(cdp: CDPConnection, signal: AbortSignal): Promise<CleanupFunction[]>;
  /** Start what follows the session's first tab */
  startPage(cdp: CDPConnection, signal: AbortSignal): Promise<void>;
  /** Navigate to the target URL and wait for the page */
  navigate(cdp: CDPConnection, chrome: LaunchedChrome | null, signal: AbortSignal): Promise<void>;
  /** Read whether the page is still loading */
  readReadiness(cdp: CDPConnection, signal: AbortSignal): Promise<void>;
  /** Release: terminate a launched Chrome */
  terminateChrome(chrome: LaunchedChrome): Promise<void>;
  /** Release: close Chrome through CDP (launched Chrome) and the page connection */
  closeConnection(chrome: LaunchedChrome | null): Promise<void>;
  /** Release: stop the session's collectors */
  stopCollectors(cleanups: CleanupFunction[]): Promise<void>;
  /** Release: stop what follows the session's current tab */
  stopPage(): Promise<void>;
}

/**
 * Acquire the session's resources in order.
 *
 * @param _stack - Receives each release
 * @param _signal - The session's stop signal
 * @param _ops - The operations
 */
export async function acquireSessionResources(
  _stack: ResourceStack,
  _signal: AbortSignal,
  _ops: StartOperations
): Promise<void> {}
