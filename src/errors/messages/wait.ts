/**
 * Wait and submit error messages.
 */

import type { PageLoadingState, PendingRequestInfo } from '@/ipc/protocol/commands.js';
import type { InvalidField } from '@/ipc/protocol/domTypes.js';
import {
  countedMatches,
  type WaitCondition,
  type WaitSnapshot,
} from '@/runtime/dom/waitCondition.js';
import type { DocumentRequestState } from '@/types.js';
import { formatDuration } from '@/ui/formatting.js';
import {
  documentRequestText,
  invalidFieldsText,
  pendingRequestsText,
  waitSnapshotSummary,
  waitTargetLabel,
} from '@/ui/messages/commands.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { type ErrorWithSuggestion, shellQuote } from './shared.js';

/** What a submit was still waiting for when its wait ran out */
export interface SubmitBlockers {
  /** The page request the submit sent, if any */
  document?: DocumentRequestState | undefined;
  /** Requests still running (the longest-running first) */
  pending?: PendingRequestInfo[] | undefined;
  /** All requests still running */
  pendingCount?: number | undefined;
}

/**
 * What to do about a submit that timed out waiting for a navigation, by how
 * far its page request got: without one the form probably submits via fetch.
 *
 * @param document - The page request, if one was sent
 * @returns Suggestion
 */
function submitNavigationSuggestion(document: DocumentRequestState | undefined): string {
  if (document === undefined) {
    return 'The form sent no page request, so it may not navigate (e.g. it submits via fetch); retry without --wait-navigation';
  }
  const details = `see it with ${sessionCommand('bdg network list --last 10')}`;
  if (document.errorText !== undefined) return `The page request failed; ${details}`;
  if (document.status !== undefined && document.status >= 400) {
    return `The server answered with an error; ${details}`;
  }
  if (document.status !== undefined) {
    return 'The server answered without a new page; retry without --wait-navigation';
  }
  return 'The server has not answered the page request yet; retry with a larger --timeout';
}

/**
 * What a timed-out submit was waiting on, in words: its page request when a
 * navigation was awaited or the request had not loaded a page, otherwise the
 * requests still running.
 *
 * @param waitNavigation - Whether a navigation was awaited
 * @param blockers - The page request and the requests still running
 * @returns e.g. `POST …/authenticate pending for 10s`; undefined when nothing is known
 */
function submitWaitDetail(waitNavigation: boolean, blockers: SubmitBlockers): string | undefined {
  const { document, pending = [] } = blockers;
  const loadedPage =
    document?.status !== undefined && document.status < 400 && document.errorText === undefined;
  if (document && (waitNavigation || !loadedPage)) return documentRequestText(document);
  if (pending.length === 0) return undefined;
  return `waiting on ${pendingRequestsText(pending, blockers.pendingCount ?? pending.length)}`;
}

/**
 * `dom submit` refused, as the browser would: the form has invalid fields.
 *
 * @param fields - Invalid fields with the browser's messages
 * @param omitted - Invalid fields left out
 * @returns e.g. "Form has invalid fields - email: Please fill out this field."
 */
export function invalidFormMessage(fields: InvalidField[], omitted = 0): string {
  return `Form has invalid fields - ${invalidFieldsText(fields, omitted)}`;
}

/**
 * The form was submitted but the wait for its result timed out. The message
 * names what it was waiting on: the page request the submit sent (pending,
 * answered with an error, failed; waiting for a navigation, also one that
 * answered), or else the requests still running.
 *
 * @param timeout - Timeout in ms
 * @param waitNavigation - Whether a navigation was awaited
 * @param blockers - The page request and the requests still running
 * @returns e.g. `Form submitted, but timed out after 10000ms waiting for navigation: POST …/authenticate pending for 10s`
 */
export function submitTimeoutError(
  timeout: number,
  waitNavigation: boolean,
  blockers: SubmitBlockers = {}
): ErrorWithSuggestion {
  const detail = submitWaitDetail(waitNavigation, blockers);
  const message = `Form submitted, but timed out after ${timeout}ms waiting for ${waitNavigation ? 'navigation' : 'network idle'}${detail ? `: ${detail}` : ''}`;
  if (!waitNavigation) {
    return {
      message,
      suggestion: 'Increase --timeout, or use --wait-network 0 to return right after submitting',
    };
  }
  return { message, suggestion: submitNavigationSuggestion(blockers.document) };
}

/**
 * Warning of a submit whose navigation happened but whose network was still
 * busy when the wait ran out (the new page is there; a slow script or
 * tracker kept loading).
 *
 * @param timeout - Timeout in ms
 * @param pending - Requests still in flight
 * @returns Warning text
 */
export function submitNetworkBusyWarning(timeout: number, pending: number): string {
  const requests = pending === 1 ? '1 request' : `${pending} requests`;
  return `The new page loaded, but ${requests} still had not finished after ${timeout}ms`;
}

/**
 * Warning of a `dom submit` whose new page answered but had not finished
 * loading at the timeout (a response that never ends, #873): no failure.
 *
 * @param timeout - Timeout in milliseconds
 * @returns Warning text
 */
export function submitStillLoadingWarning(timeout: number): string {
  return `The new page was still loading after ${timeout}ms (its response had not ended)`;
}

/**
 * `bdg dom wait` without a selector or --load, or with --text/--gone but no selector.
 *
 * @returns Message and suggestion
 */
export function waitTargetRequiredError(): ErrorWithSuggestion {
  return {
    message: 'dom wait needs a selector (--text and --gone apply to its matches), or --load',
    suggestion: `e.g. ${sessionCommand("bdg dom wait '#result' --visible")}, ${sessionCommand("bdg dom wait body --text 'Welcome'")} or ${sessionCommand('bdg dom wait --load')}`,
  };
}

/**
 * `bdg dom wait` that ran out of time: what it waited for and what the page
 * showed last, with a next step that fits.
 *
 * @param condition - What was waited for
 * @param snapshot - Last thing the page reported (none when it never answered)
 * @param timeoutMs - The --timeout
 * @param loading - Requests the loading page still waits on (none when there are none)
 * @returns Message and suggestion
 */
export function waitTimeoutError(
  condition: WaitCondition,
  snapshot: WaitSnapshot | undefined,
  timeoutMs: number,
  loading?: PageLoadingState
): ErrorWithSuggestion {
  const seen = snapshot
    ? `last seen: ${waitSnapshotSummary(snapshot, condition)}`
    : 'the page did not answer';
  return {
    message: `Timed out after ${formatDuration(timeoutMs)} waiting for ${waitGoal(condition)} (${seen})`,
    suggestion: waitTimeoutSuggestion(condition, snapshot, loading),
  };
}

/**
 * What `bdg dom wait` waits for, as a phrase.
 *
 * @param condition - What is waited for
 * @returns e.g. `#finish to be visible` or `the page to load`
 */
function waitGoal(condition: WaitCondition): string {
  if (condition.selector === undefined) return 'the page to load';
  const state = condition.gone
    ? condition.visible
      ? 'to be hidden'
      : 'to be gone'
    : condition.visible
      ? 'to be visible'
      : 'to appear';
  return `${waitTargetLabel(condition)} ${state}${condition.load ? ' and the page to load' : ''}`;
}

/**
 * Next step after a `bdg dom wait` timeout.
 *
 * @param condition - What was waited for
 * @param snapshot - Last thing the page reported
 * @param loading - Requests the loading page still waits on
 * @returns Suggestion
 */
function waitTimeoutSuggestion(
  condition: WaitCondition,
  snapshot: WaitSnapshot | undefined,
  loading: PageLoadingState | undefined
): string {
  const more = 'allow more time with --timeout <ms>';
  const selector = condition.selector;
  if (snapshot && snapshot.readyState !== 'complete') {
    if (loading && loading.pending.length > 0) {
      const full =
        loading.pendingCount > loading.pending.length
          ? ` (all of them with ${sessionCommand('bdg peek')})`
          : '';
      return `The page is still loading; waiting on: ${pendingRequestsText(loading.pending, loading.pendingCount)}${full}; ${more}`;
    }
    return `The page is still loading; see the requests it waits on with ${sessionCommand('bdg peek')}, or ${more}`;
  }
  if (
    !snapshot ||
    selector === undefined ||
    condition.gone ||
    countedMatches(snapshot, condition) > 0
  ) {
    return `Check the page with ${sessionCommand('bdg peek')}, or ${more}`;
  }
  if (snapshot.count === 0) {
    return `Check the selector with ${sessionCommand(`bdg dom query ${shellQuote(selector)}`)}, or ${more}`;
  }
  if (snapshot.textCount === 0) {
    return `The matches do not contain the text; see what they say with ${sessionCommand(`bdg dom query ${shellQuote(selector)}`)}`;
  }
  return `The matches are hidden; see why with ${sessionCommand(`bdg dom layout ${shellQuote(selector)}`)}, or ${more}`;
}
