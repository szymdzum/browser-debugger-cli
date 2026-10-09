/**
 * Running page interactions (fill, click, submit, pressKey, scroll) one at a
 * time, reporting the dialogs, network requests and page changes they caused,
 * and whether the page was still changing when they returned.
 */

import type { TelemetryStore } from './TelemetryStore.js';

import type { CDPConnection } from '@/connection/cdp.js';
import type {
  ActionEffects,
  DialogChoice,
  DialogInfo,
  TriggeredRequest,
} from '@/ipc/protocol/domTypes.js';
import { pendingChanges, watchActionEffects } from '@/runtime/dom/actionEffects.js';
import { UNBIND_TARGET_SCRIPT } from '@/runtime/dom/targetNode.js';
import { toDownloadInfo } from '@/telemetry/downloads.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

import { watchActionErrors } from './actionErrors.js';
import { watchTriggeredRequests } from './triggeredRequests.js';

const log = createLogger('dom');

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
   * Report navigation, new messages and the console errors it caused
   * (default true; off for page navigation, which reports its own page)
   */
  reportEffects?: boolean;
  /**
   * Say when it had no visible effect (`effect: "none"`): only for actions
   * whose effect shows in the DOM (click, submit) and that waited for it
   */
  detectNoEffect?: boolean;
  /**
   * List the elements it showed (`shown`): for hover and key presses, whose
   * effect is often a menu, tooltip or new item rather than a message
   */
  reportShown?: boolean;
  /**
   * Say when the page was still changing as it returned (`settled: false`
   * with `pending`): for actions that start app transitions (click, key
   * press) and waited for the network
   */
  detectUnsettled?: boolean;
  /**
   * How to answer the dialogs opened while it runs (`--dialog`,
   * `--prompt-text`; default: the session default)
   */
  dialogs?: DialogChoice;
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
 * Console messages the session has logged, dropped ones included.
 *
 * @param store - Session store
 * @returns Count that only grows
 */
function consoleMessagesLogged(store: TelemetryStore): number {
  return store.consoleDropped + store.consoleMessages.length;
}

/**
 * Create the runner for a session's interactions.
 *
 * Interactions share the page's focus and keyboard: two concurrent `pressKey`
 * commands would interleave keystrokes into each other's field, so they are
 * queued. After each one, the bound target (`window.__bdgTarget`) is removed
 * from the page (without waiting: during a pending navigation that takes until
 * the new page commits), and the dialogs it opened, what it changed on the
 * page (see {@link watchActionEffects}; a console message logged meanwhile
 * counts as an effect), the network requests it
 * triggered (see {@link watchTriggeredRequests}), the console errors it
 * caused (see {@link watchActionErrors}; read once its effects were
 * collected, so a timer's error after the action is in) and the downloads
 * that began meanwhile (as they stand when it returns) are added to its
 * result,
 * and, when asked, what the page was still working on (see
 * {@link pendingChanges}). They are attributed by time: a dialog or request
 * started by a page timer or a navigation started earlier is reported by
 * whichever interaction is running then. Dialogs opened while it runs (its
 * effect wait included) are answered as it chose (`dialogs`); because
 * interactions are queued, its choice never reaches another interaction, and
 * it is cleared when it returns, so a dialog a timer opens later gets the
 * session default. A command that is not an interaction (`dom eval`, `cdp`)
 * running meanwhile shares its choice.
 *
 * @param store - Session store recording answered dialogs and network requests
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
      store.dialogAnswers.setActionChoice(options.dialogs);
      const firstDialog = store.dialogs.length;
      const firstDownload = store.downloads.length;
      const firstConsoleMessage = consoleMessagesLogged(store);
      const collectRequests =
        options.reportRequests === false ? undefined : watchTriggeredRequests(store);
      const effects = options.reportEffects === false ? undefined : watchActionEffects(cdp);
      const collectErrors = effects && watchActionErrors(store);
      try {
        const result = await action();
        const dialogs = store.dialogs.slice(firstDialog);
        if (!succeeded(result)) return { ...result, ...(dialogs.length > 0 && { dialogs }) };
        const collected = await effects?.collect({
          dialogs: dialogs.length,
          consoleMessages: () => consoleMessagesLogged(store) - firstConsoleMessage,
          detectNoEffect: options.detectNoEffect === true,
          reportShown: options.reportShown === true,
          detectUnsettled: options.detectUnsettled === true,
        });
        const { work, ...changes } = collected ?? {};
        const requests = collectRequests?.();
        const downloads = store.downloads.slice(firstDownload).map(toDownloadInfo);
        const pending =
          options.detectUnsettled && work
            ? pendingChanges(work, requests?.triggeredRequests)
            : undefined;
        return {
          ...result,
          ...(dialogs.length > 0 && { dialogs }),
          ...changes,
          ...collectErrors?.(),
          ...(pending && { settled: false as const, pending }),
          ...(downloads.length > 0 && { downloads }),
          ...requests,
        };
      } finally {
        store.dialogAnswers.setActionChoice(undefined);
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
