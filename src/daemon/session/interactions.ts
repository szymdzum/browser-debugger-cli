/**
 * Running page interactions (fill, click, submit, pressKey, scroll) one at a
 * time, reporting the dialogs, network requests and page changes they caused.
 */

import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type { ActionEffects, DialogInfo, TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import { watchActionEffects } from '@/runtime/dom/actionEffects.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

import { watchTriggeredRequests } from './triggeredRequests.js';

const log = createLogger('dom');

/** Removes the node bound for index-based commands from the page */
const UNBIND_TARGET_SCRIPT = 'delete window.__bdgTarget';

/** What an interaction caused besides its own result */
interface InteractionReport extends ActionEffects {
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
  /**
   * Report navigation and new messages (default true; off for page
   * navigation, which reports its own page)
   */
  reportEffects?: boolean;
  /**
   * Say when it had no visible effect (`effect: "none"`): only for actions
   * whose effect shows in the DOM (click, submit) and that waited for it
   */
  detectNoEffect?: boolean;
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
 * the new page commits), and the dialogs it opened, what it changed on the
 * page (see {@link watchActionEffects}) and the network requests it
 * triggered (see {@link watchTriggeredRequests}) are added to its result.
 * They are attributed by time: a dialog or request started by a page timer
 * or a navigation started earlier is reported by whichever interaction is
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
      const effects = options.reportEffects === false ? undefined : watchActionEffects(cdp);
      try {
        const result = await action();
        const dialogs = store.dialogs.slice(firstDialog);
        const changes = succeeded(result)
          ? await effects?.collect({
              dialogs: dialogs.length,
              detectNoEffect: options.detectNoEffect === true,
            })
          : undefined;
        return {
          ...result,
          ...(dialogs.length > 0 && { dialogs }),
          ...changes,
          ...(succeeded(result) && collectRequests?.()),
        };
      } finally {
        effects?.dispose();
        void cdp
          .send('Runtime.evaluate', { expression: UNBIND_TARGET_SCRIPT })
          .catch((error: unknown) => log.debug(`Target not unbound: ${getErrorMessage(error)}`));
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
}
