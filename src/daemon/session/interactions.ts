/**
 * Running page interactions (fill, click, submit, pressKey, scroll) one at a
 * time, reporting the dialogs and network requests they caused.
 */

import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type { DialogInfo, TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

import { watchTriggeredRequests } from './triggeredRequests.js';

const log = createLogger('dom');

/** Removes the node bound for index-based commands from the page */
const UNBIND_TARGET_SCRIPT = 'delete window.__bdgTarget';

/** What an interaction caused besides its own result */
interface InteractionReport {
  dialogs?: DialogInfo[];
  triggeredRequests?: TriggeredRequest[];
  triggeredRequestsOmitted?: number;
}

/** How an interaction is reported */
export interface InteractionOptions {
  /**
   * List the network requests it triggered (default true; off for page
   * navigation, whose requests are the whole page load)
   */
  reportRequests?: boolean;
}

/** Runs one interaction after the previous one finished */
export type InteractionRunner = <T extends object>(
  cdp: CDPConnection,
  action: () => Promise<T>,
  options?: InteractionOptions
) => Promise<T & InteractionReport>;

/**
 * Whether an action result is a success (results without a `success` flag are).
 *
 * @param result - Action result
 * @returns False for `{ success: false }`
 */
function succeeded(result: object): boolean {
  return !('success' in result) || result.success !== false;
}

/**
 * Create the runner for a session's interactions.
 *
 * Interactions share the page's focus and keyboard: two concurrent `pressKey`
 * commands would interleave keystrokes into each other's field, so they are
 * queued. After each one, the bound target (`window.__bdgTarget`) is removed
 * from the page (without waiting: during a pending navigation that takes until
 * the new page commits), and the dialogs it opened and the network requests
 * it triggered (see {@link watchTriggeredRequests}) are added to its result.
 * Both are attributed by time: a dialog or request started by a page timer or
 * a navigation started earlier is reported by whichever interaction is
 * running then.
 *
 * @param store - Session store recording accepted dialogs and network requests
 * @returns Interaction runner
 */
export function createInteractionRunner(store: TelemetryStore): InteractionRunner {
  let queue: Promise<unknown> = Promise.resolve();
  return <T extends object>(
    cdp: CDPConnection,
    action: () => Promise<T>,
    options: InteractionOptions = {}
  ) => {
    const run = queue.then(async (): Promise<T & InteractionReport> => {
      const firstDialog = store.dialogs.length;
      const collectRequests =
        options.reportRequests === false ? undefined : watchTriggeredRequests(store);
      try {
        const result = await action();
        const dialogs = store.dialogs.slice(firstDialog);
        return {
          ...result,
          ...(dialogs.length > 0 && { dialogs }),
          ...(succeeded(result) && collectRequests?.()),
        };
      } finally {
        void cdp
          .send('Runtime.evaluate', { expression: UNBIND_TARGET_SCRIPT })
          .catch((error: unknown) => log.debug(`Target not unbound: ${getErrorMessage(error)}`));
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
}
