/**
 * Attach to the page's child targets: out-of-process (cross-origin) iframes
 * and workers.
 *
 * Their console and log events do not reach the page's own session. With
 * flattened auto-attach, each child gets a session on the same connection;
 * its events arrive with that session id, and commands are sent to it by id.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('targets');

/** Auto-attach settings: children start running; one connection for all sessions */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

/**
 * Prepare a newly attached child target: run the caller's setup on its
 * session, then auto-attach to its own children (iframes nested in iframes).
 *
 * @param typed - Typed CDP connection
 * @param sessionId - Session of the attached target
 * @param url - Target URL (for logs)
 * @param setup - Enables what the caller needs on the session
 */
async function prepareChild(
  typed: TypedCDPConnection,
  sessionId: string,
  url: string,
  setup: (sessionId: string) => Promise<void>
): Promise<void> {
  try {
    await setup(sessionId);
    await typed.send('Target.setAutoAttach', AUTO_ATTACH, sessionId);
    log.debug(`Attached to ${url}`);
  } catch (error) {
    log.debug(`Could not prepare attached target ${url}: ${getErrorMessage(error)}`);
  }
}

/**
 * Attach to child targets of the page and run `setup` on each one's session.
 *
 * @param cdp - CDP connection to the page
 * @param setup - Enables domains on a child session (e.g. `Runtime.enable`)
 * @returns Cleanup function that stops handling new targets
 */
export async function attachChildTargets(
  cdp: CDPConnection,
  setup: (sessionId: string) => Promise<void>
): Promise<CleanupFunction> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);

  registry.registerTyped(typed, 'Target.attachedToTarget', (params) => {
    void prepareChild(typed, params.sessionId, params.targetInfo.url, setup);
  });

  await typed.send('Target.setAutoAttach', AUTO_ATTACH);

  return () => registry.cleanup();
}
