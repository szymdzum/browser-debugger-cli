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
 * Acquire the session's resources in order: Chrome, its page target (a
 * launched Chrome), the page connection, `--state`, the emulation, the
 * session's collectors, the first tab's collectors, the navigation and the
 * readiness read. Every step runs through {@link ResourceStack.acquire}, so
 * a stop (the signal) ends the start at the next step boundary at the
 * latest, and steps that wait end at once where the operation honours the
 * signal.
 *
 * The releases registered here are the teardown order, last first: the
 * tab's collectors, the session's collectors, `Browser.close` and the page
 * connection, then Chrome's termination.
 *
 * @param stack - Receives each release
 * @param signal - The session's stop signal
 * @param ops - The operations
 * @throws The signal's reason when stopped, or the failing step's error
 */
export async function acquireSessionResources(
  stack: ResourceStack,
  signal: AbortSignal,
  ops: StartOperations
): Promise<void> {
  const chrome = await stack.acquire(
    'chrome',
    signal,
    (s) => ops.launchChrome(s),
    (launched) => (launched ? ops.terminateChrome(launched) : undefined)
  );
  if (chrome) await stack.acquire('page target', signal, (s) => ops.findPageTarget(s));
  const cdp = await stack.acquire(
    'page connection',
    signal,
    (s) => ops.connect(s),
    () => ops.closeConnection(chrome)
  );
  await stack.acquire('state', signal, (s) => ops.restoreState(cdp, s));
  await stack.acquire('emulation', signal, (s) => ops.applyEmulation(cdp, s));
  await stack.acquire(
    'session collectors',
    signal,
    (s) => ops.startCollectors(cdp, s),
    (cleanups) => ops.stopCollectors(cleanups)
  );
  await stack.acquire(
    'page collectors',
    signal,
    (s) => ops.startPage(cdp, s),
    () => ops.stopPage()
  );
  await stack.acquire('navigation', signal, (s) => ops.navigate(cdp, chrome, s));
  await stack.acquire('readiness', signal, (s) => ops.readReadiness(cdp, s));
}
