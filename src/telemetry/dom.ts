import type { CDPConnection } from '@/connection/cdp.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/**
 * Prepare CDP domains for DOM collection.
 *
 * Enables Page, DOM, and Runtime domains required for capturing DOM snapshots.
 *
 * @param cdp - CDP connection instance
 * @returns Cleanup function that disables Runtime domain
 */
export async function prepareDOMCollection(cdp: CDPConnection): Promise<CleanupFunction> {
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Runtime.enable');

  return () => {
    try {
      cdp.send('Runtime.disable').catch((error) => {
        log.debug(`Failed to disable Runtime: ${getErrorMessage(error)}`);
      });
    } catch (error) {
      log.debug(`Failed to disable Runtime: ${getErrorMessage(error)}`);
    }
  };
}
