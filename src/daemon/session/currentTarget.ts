import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type { PageLoadingState } from '@/ipc/protocol/commands.js';
import { readPageLoadingState } from '@/runtime/page/loadingState.js';
import { createLogger } from '@/ui/logging/index.js';
import { raceTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/** How long a command waits for Chrome's answer before it shows the stored page */
export const TARGET_INFO_TIMEOUT_MS = 1500;

/**
 * Read the session page's URL and title from Chrome into the store.
 *
 * Chrome sends no event for a title a script sets after the page loaded, so
 * the stored copy lags until a command asks. The store keeps what it has when
 * Chrome cannot answer (a crashed page) or answers for another tab.
 *
 * @param cdp - The session's page connection
 * @param store - Telemetry store whose target info is refreshed
 * @param timeoutMs - Longest wait for Chrome
 */
export async function refreshCurrentTarget(
  cdp: Pick<CDPConnection, 'send'>,
  store: TelemetryStore,
  timeoutMs = TARGET_INFO_TIMEOUT_MS
): Promise<void> {
  const stored = store.targetInfo;
  if (!stored) return;
  try {
    const { targetInfo } = (await raceTimeout(cdp.send('Target.getTargetInfo', {}), timeoutMs, {
      onTimeout: (): never => {
        throw new Error(`no answer within ${timeoutMs} ms`);
      },
    })) as {
      targetInfo: { targetId: string; url: string; title: string };
    };
    if (targetInfo.targetId !== stored.id || store.targetInfo !== stored) return;
    store.setTargetInfo({ ...stored, url: targetInfo.url, title: targetInfo.title });
  } catch (error) {
    log.debug(`Could not read the page's target info: ${getErrorMessage(error)}`);
  }
}

/**
 * Refresh the session page's URL and title and read whether the document is
 * still loading, both at once so the command waits for the slower of the two,
 * not their sum (each is bounded: 1.5 s and 1 s).
 *
 * The loading state is asked of the page when a command runs, with the
 * probe `page navigate` and the start use (`document.readyState` and the
 * requests still running), not kept from events: a parser blocked by a
 * script raises none when it stalls or resumes, so a stored flag would
 * need a second source of truth. A crashed page is not asked.
 *
 * @param cdp - The session's page connection
 * @param store - Telemetry store whose target info is refreshed
 * @returns The loading state, or undefined when the page has loaded or did not answer
 */
export async function refreshCurrentPage(
  cdp: CDPConnection,
  store: TelemetryStore
): Promise<PageLoadingState | undefined> {
  const [, loading] = await Promise.all([
    refreshCurrentTarget(cdp, store),
    store.pageCrashedAt === undefined
      ? readPageLoadingState(cdp, store.pendingNetworkRequests.values())
      : undefined,
  ]);
  return loading;
}
