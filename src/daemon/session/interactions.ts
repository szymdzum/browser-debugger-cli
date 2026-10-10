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
  InvalidField,
  TriggeredRequest,
} from '@/ipc/protocol/domTypes.js';
import type { OpenedTab, TabClosedSwitch } from '@/ipc/protocol/tabTypes.js';
import {
  pendingChanges,
  watchActionEffects,
  type CollectedEffects,
} from '@/runtime/dom/actionEffects.js';
import type { BoundedInvalidFields } from '@/runtime/dom/blockedSubmit.js';
import { UNBIND_TARGET_SCRIPT } from '@/runtime/dom/targetNode.js';
import { toDownloadInfo } from '@/telemetry/downloads.js';
import { mayCarrySubmit } from '@/telemetry/requestKinds.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

import { watchActionErrors } from './actionErrors.js';
import { watchTriggeredRequests, type CollectedRequests } from './triggeredRequests.js';

const log = createLogger('dom');

/** What an interaction caused besides its own result */
interface InteractionReport extends ActionEffects {
  dialogs?: DialogInfo[];
  triggeredRequests?: TriggeredRequest[];
  triggeredRequestsOmitted?: number;
  submitBlocked?: InvalidField[];
  submitBlockedOmitted?: number;
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
   * Read which fields blocked the submit it started (`submitBlocked`): for
   * clicks and Enter or Space, whose script left a probe on the form they
   * submit (and, for keys, a watch for `invalid` events). Read only when it
   * neither navigated nor triggered a request other than assets (see
   * {@link blockedSubmit}).
   */
  readBlockedSubmit?: () => Promise<BoundedInvalidFields | undefined>;
  /**
   * How to answer the dialogs opened while it runs (`--dialog`,
   * `--prompt-text`; default: the session default)
   */
  dialogs?: DialogChoice;
}

/** What the session knows about its tabs, for interaction results */
export interface TabReports {
  /** A mark for {@link openedSince} */
  openedCount: () => number;
  /** Tabs and windows opened after a mark */
  openedSince: (mark: number) => OpenedTab[];
  /** The latest switch after the session's tab closed that no action reported yet */
  takeClosedSwitch: () => TabClosedSwitch | undefined;
  /**
   * When a connection was lost: settles once the session moved to another
   * tab or ended (undefined for a connection that was not lost)
   */
  pageLost: (cdp: CDPConnection) => Promise<void> | undefined;
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
 * The tabs opened since a mark, and the switch after the session's tab closed.
 *
 * @param tabs - Tab reports
 * @param firstOpened - Mark taken as the interaction began
 * @returns `opened`, `tabClosed` and `switchedTo`, each absent when there is none
 */
function tabReport(
  tabs: TabReports | undefined,
  firstOpened: number
): Pick<ActionEffects, 'opened' | 'tabClosed' | 'switchedTo'> {
  if (!tabs) return {};
  const opened = tabs.openedSince(firstOpened);
  return { ...(opened.length > 0 && { opened }), ...tabs.takeClosedSwitch() };
}

/**
 * After an interaction failed: when its tab's connection was lost because
 * the tab closed and the session moved to another, the tab report saying so.
 *
 * @param cdp - The interaction's connection
 * @param tabs - Tab reports
 * @param firstOpened - Mark taken as the interaction began
 * @returns The report with `tabClosed`, or undefined when the failure stands
 */
async function closedTabReport(
  cdp: CDPConnection,
  tabs: TabReports | undefined,
  firstOpened: number
): Promise<ReturnType<typeof tabReport> | undefined> {
  const lost = tabs?.pageLost(cdp);
  if (!lost) return undefined;
  await lost;
  const report = tabReport(tabs, firstOpened);
  return report.tabClosed ? report : undefined;
}

/**
 * The fields that blocked the submit an interaction started: read when it
 * did not navigate (nor was a new page still loading) and triggered no
 * request that may carry a form's data ({@link mayCarrySubmit}), since such
 * a request or a navigation means something was sent. Assets the page
 * loaded meanwhile (an image, a font) don't count.
 *
 * @param read - Reads the fields (from {@link InteractionOptions})
 * @param changes - What collecting saw, with the page's work
 * @param requests - Requests it triggered (none known without network telemetry)
 * @returns `submitBlocked`, or nothing
 */
async function blockedSubmit(
  read: InteractionOptions['readBlockedSubmit'],
  changes: CollectedEffects | undefined,
  requests: CollectedRequests | undefined
): Promise<Pick<InteractionReport, 'submitBlocked' | 'submitBlockedOmitted'>> {
  if (!read || changes?.navigation || changes?.work?.navigating) return {};
  if (
    requests?.triggeredRequests.some(mayCarrySubmit) === true ||
    (requests?.triggeredRequestsOmitted ?? 0) > 0
  )
    return {};
  const blocked = await read();
  if (!blocked) return {};
  return {
    submitBlocked: blocked.fields,
    ...(blocked.omitted > 0 && { submitBlockedOmitted: blocked.omitted }),
  };
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
 * {@link pendingChanges}); with Fetch interception on and requests still
 * pending, `fetchInterception` (they may be paused). They are attributed by time: a dialog or request
 * started by a page timer or a navigation started earlier is reported by
 * whichever interaction is running then. Dialogs opened while it runs (its
 * effect wait included) are answered as it chose (`dialogs`); because
 * interactions are queued, its choice never reaches another interaction, and
 * it is cleared when it returns, so a dialog a timer opens later gets the
 * session default. A command that is not an interaction (`dom eval`, `cdp`)
 * running meanwhile shares its choice.
 * Tabs and windows opened meanwhile
 * are added as `opened`, and a switch made because the session's tab closed
 * since the previous interaction as `tabClosed` and `switchedTo`. When the
 * tab closes during the interaction (a popup's button calling
 * `window.close()`), the switch is waited for and reported, and the
 * interaction succeeds with it even when reading its effects failed on the
 * lost connection.
 *
 * @param store - Session store recording answered dialogs and network requests
 * @param tabs - The session's tabs (none: no tab reports)
 * @returns Interaction runner
 */
export function createInteractionRunner(
  store: TelemetryStore,
  tabs?: TabReports
): InteractionRunner {
  let queue: Promise<unknown> = Promise.resolve();
  return <T extends object>(
    cdp: CDPConnection,
    action: () => Promise<T>,
    options: InteractionOptions = {}
  ) => {
    const run = queue.then(async (): Promise<T & InteractionReport> => {
      const firstDialog = store.dialogs.length;
      const firstDownload = store.downloads.length;
      const firstConsoleMessage = consoleMessagesLogged(store);
      const firstOpened = tabs?.openedCount() ?? 0;
      const collectRequests =
        options.reportRequests === false ? undefined : watchTriggeredRequests(store);
      const effects = options.reportEffects === false ? undefined : watchActionEffects(cdp);
      const collectErrors = effects && watchActionErrors(store);
      let result: T | undefined;
      try {
        store.dialogAnswers.setActionChoice(options.dialogs);
        result = await action();
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
        const blocked = await blockedSubmit(options.readBlockedSubmit, collected, requests);
        if (effects) await tabs?.pageLost(cdp);
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
          ...blocked,
          ...(store.fetchInterceptionEnabled &&
            requests?.triggeredRequests.some((request) => request.pending) && {
              fetchInterception: true as const,
            }),
          ...(downloads.length > 0 && { downloads }),
          ...tabReport(tabs, firstOpened),
          ...requests,
        };
      } catch (error) {
        const closed = effects && (await closedTabReport(cdp, tabs, firstOpened));
        if (!closed) throw error;
        const dialogs = store.dialogs.slice(firstDialog);
        return {
          ...(result ?? ({ success: true } as unknown as T)),
          ...(dialogs.length > 0 && { dialogs }),
          ...closed,
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
