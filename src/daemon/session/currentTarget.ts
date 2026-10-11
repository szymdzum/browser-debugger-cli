import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/**
 * Read the session page's URL and title from Chrome into the store.
 *
 * Chrome sends no event for a title a script sets after the page loaded, so
 * the stored copy lags until a command asks. The store keeps what it has when
 * Chrome cannot answer (a crashed page) or answers for another tab.
 *
 * @param cdp - The session's page connection
 * @param store - Telemetry store whose target info is refreshed
 */
export async function refreshCurrentTarget(
  cdp: Pick<CDPConnection, 'send'>,
  store: TelemetryStore
): Promise<void> {
  const stored = store.targetInfo;
  if (!stored) return;
  try {
    const { targetInfo } = (await cdp.send('Target.getTargetInfo', {})) as {
      targetInfo: { targetId: string; url: string; title: string };
    };
    if (targetInfo.targetId !== stored.id || store.targetInfo?.id !== stored.id) return;
    store.setTargetInfo({ ...stored, url: targetInfo.url, title: targetInfo.title });
  } catch (error) {
    log.debug(`Could not read the page's target info: ${getErrorMessage(error)}`);
  }
}
