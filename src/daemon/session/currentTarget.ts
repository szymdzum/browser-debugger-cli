import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
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
