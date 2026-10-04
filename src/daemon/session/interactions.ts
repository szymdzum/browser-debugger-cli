/**
 * Running page interactions (fill, click, submit, pressKey, scroll) one at a
 * time, reporting the dialogs they caused.
 */

import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type { DialogInfo } from '@/ipc/protocol/domTypes.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Removes the node bound for index-based commands from the page */
const UNBIND_TARGET_SCRIPT = 'delete window.__bdgTarget';

/** Runs one interaction after the previous one finished */
export type InteractionRunner = <T extends object>(
  cdp: CDPConnection,
  action: () => Promise<T>
) => Promise<T & { dialogs?: DialogInfo[] }>;

/**
 * Create the runner for a session's interactions.
 *
 * Interactions share the page's focus and keyboard: two concurrent `pressKey`
 * commands would interleave keystrokes into each other's field, so they are
 * queued. After each one, the bound target (`window.__bdgTarget`) is removed
 * from the page (without waiting: during a pending navigation that takes until
 * the new page commits), and the dialogs it opened are added to its result.
 * Dialogs are attributed by time: one opened by a page timer or a navigation
 * started earlier is reported by whichever interaction is running then.
 *
 * @param store - Session store recording accepted dialogs
 * @returns Interaction runner
 */
export function createInteractionRunner(store: TelemetryStore): InteractionRunner {
  let queue: Promise<unknown> = Promise.resolve();
  return <T extends object>(cdp: CDPConnection, action: () => Promise<T>) => {
    const run = queue.then(async () => {
      const firstDialog = store.dialogs.length;
      try {
        const result = await action();
        const dialogs = store.dialogs.slice(firstDialog);
        return dialogs.length > 0 ? { ...result, dialogs } : result;
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
