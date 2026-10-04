/**
 * Attach to the page's child targets: out-of-process (cross-origin) iframes
 * and workers.
 *
 * Their console, log and network events do not reach the page's own session.
 * With flattened auto-attach, each child gets a session on the same
 * connection; its events arrive with that session id, and commands are sent
 * to it by id. Children start paused, so every collector can enable its
 * domains before the child loads anything; they are resumed afterwards.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('targets');

/** Auto-attach settings: children wait until set up; one connection for all sessions */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

/**
 * How long a paused child waits for the collectors' setup before it is
 * resumed anyway. A paused service worker answers no command until it runs,
 * so waiting for its setup kept it (and the page's `register()`) paused
 * forever; its pending commands complete once it runs.
 */
const SETUP_WAIT_MS = 1000;

/** Turns auto-attach off again (children attached afterwards would stay paused) */
const NO_AUTO_ATTACH = { autoAttach: false, waitForDebuggerOnStart: false };

/** Enables what a collector needs on a child session (e.g. `Runtime.enable`) */
type ChildSetup = (sessionId: string) => Promise<void>;

/** An attached child target */
interface AttachedChild {
  url: string;
  targetId: string;
}

/** Child-target handling shared by all collectors of one connection */
interface AttachManager {
  typed: TypedCDPConnection;
  setups: Set<ChildSetup>;
  /** Sessions of attached children, with their URL (for logs) and target id */
  sessions: Map<string, AttachedChild>;
  registry: CDPHandlerRegistry;
}

const managers = new WeakMap<CDPConnection, AttachManager>();

/**
 * Run setups on a child session, logging (not throwing) failures.
 *
 * @param sessionId - Session of the attached target
 * @param url - Target URL (for logs)
 * @param setups - Collector setups to run
 */
async function runSetups(
  sessionId: string,
  url: string,
  setups: Iterable<ChildSetup>
): Promise<void> {
  const results = await Promise.allSettled([...setups].map((setup) => setup(sessionId)));
  for (const result of results) {
    if (result.status === 'rejected') {
      log.debug(`Setup of attached target ${url} failed: ${getErrorMessage(result.reason)}`);
    }
  }
}

/**
 * Prepare a newly attached child target: run every collector's setup on its
 * session, auto-attach to its own children (iframes nested in iframes), and
 * resume it (after at most {@link SETUP_WAIT_MS}).
 *
 * @param manager - Shared manager of the connection
 * @param sessionId - Session of the attached target
 * @param child - Target URL (for logs) and id
 */
async function prepareChild(
  manager: AttachManager,
  sessionId: string,
  child: AttachedChild
): Promise<void> {
  const { url } = child;
  manager.sessions.set(sessionId, child);
  try {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all([
        runSetups(sessionId, url, manager.setups),
        manager.typed.send('Target.setAutoAttach', AUTO_ATTACH, sessionId),
      ]),
      new Promise((resolve) => (timer = setTimeout(resolve, SETUP_WAIT_MS))),
    ]).finally(() => clearTimeout(timer));
    log.debug(`Attached to ${url || 'a new target'}`);
  } catch (error) {
    log.debug(`Could not prepare attached target ${url}: ${getErrorMessage(error)}`);
  } finally {
    await manager.typed
      .send('Runtime.runIfWaitingForDebugger', {}, sessionId)
      .catch((error: unknown) => log.debug(`Could not resume ${url}: ${getErrorMessage(error)}`));
  }
}

/**
 * Create the shared manager of a connection (auto-attach starts once the
 * first setup is registered).
 *
 * @param cdp - CDP connection to the page
 * @returns The manager
 */
function createManager(cdp: CDPConnection): AttachManager {
  const typed = new TypedCDPConnection(cdp);
  const manager: AttachManager = {
    typed,
    setups: new Set(),
    sessions: new Map(),
    registry: new CDPHandlerRegistry(),
  };
  manager.registry.registerTyped(typed, 'Target.attachedToTarget', (params) => {
    const { url, targetId } = params.targetInfo;
    void prepareChild(manager, params.sessionId, { url, targetId });
  });
  manager.registry.registerTyped(typed, 'Target.detachedFromTarget', (params) => {
    manager.sessions.delete(params.sessionId);
  });
  managers.set(cdp, manager);
  return manager;
}

/**
 * Stop auto-attaching once no collector needs children any more.
 *
 * @param cdp - CDP connection to the page
 * @param manager - The connection's manager
 */
function retireManager(cdp: CDPConnection, manager: AttachManager): void {
  manager.registry.cleanup();
  managers.delete(cdp);
  void manager.typed
    .send('Target.setAutoAttach', { ...NO_AUTO_ATTACH, flatten: true })
    .catch((error: unknown) => log.debug(`Auto-attach not turned off: ${getErrorMessage(error)}`));
}

/**
 * Attach to child targets of the page and run `setup` on each one's session
 * before it starts. Children that are already attached (e.g. when another
 * collector registered first) get the setup right away.
 *
 * @param cdp - CDP connection to the page
 * @param setup - Enables domains on a child session (e.g. `Runtime.enable`)
 * @returns Cleanup function that stops running `setup` for new targets
 */
export async function attachChildTargets(
  cdp: CDPConnection,
  setup: ChildSetup
): Promise<CleanupFunction> {
  const existing = managers.get(cdp);
  const manager = existing ?? createManager(cdp);
  manager.setups.add(setup);
  const cleanup = (): void => {
    manager.setups.delete(setup);
    if (manager.setups.size === 0 && managers.get(cdp) === manager) retireManager(cdp, manager);
  };
  if (existing) {
    for (const [sessionId, { url }] of manager.sessions) void runSetups(sessionId, url, [setup]);
    return cleanup;
  }
  try {
    await manager.typed.send('Target.setAutoAttach', AUTO_ATTACH);
  } catch (error) {
    manager.setups.delete(setup);
    manager.registry.cleanup();
    managers.delete(cdp);
    throw error;
  }
  return cleanup;
}

/**
 * Session of an attached child target (e.g. an out-of-process iframe) on the
 * connection. Its commands are answered even while the target's scripts keep
 * it busy, unlike those of a session attached afterwards.
 *
 * @param cdp - CDP connection to the page
 * @param targetId - Target id (an iframe target's id is its frame id)
 * @returns The session, undefined when the target is not attached
 */
export function attachedSessionOf(cdp: CDPConnection, targetId: string): string | undefined {
  for (const [sessionId, child] of managers.get(cdp)?.sessions ?? []) {
    if (child.targetId === targetId) return sessionId;
  }
  return undefined;
}
