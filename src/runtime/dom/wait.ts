/**
 * `bdg dom wait`: wait in the page until elements appear, become visible,
 * contain a text or are gone, and/or the page has loaded.
 *
 * The page watches itself (a MutationObserver plus a short poll for style
 * and frame changes the observer cannot see) and answers as soon as what it
 * shows changes; the condition is decided here ({@link isWaitConditionMet}).
 * Each page call lasts at most {@link WAIT_SLICE_MS}, so a navigation during
 * the wait (the page's context is destroyed) only costs a retry on the new
 * document.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { invalidSelectorError, waitTimeoutError } from '@/errors/messages.js';
import type { DomWaitCommand, DomWaitData } from '@/ipc/protocol/commands.js';
import { DEEP_QUERY_JS, FILTER_MATCHING_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import {
  isWaitConditionMet,
  normalizeWaitText,
  type WaitCondition,
  type WaitSnapshot,
} from '@/runtime/dom/waitCondition.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';
import { parseSelectorFilters } from '@/utils/selectorFilters.js';

const log = createLogger('dom');

/** Longest a single page call waits for a change */
const WAIT_SLICE_MS = 2000;

/** Pause before asking a page that could not answer (navigating) again */
const RETRY_DELAY_MS = 100;

/**
 * Page-side: report what the page shows (matches, text matches, visible
 * ones, readyState) as soon as it differs from `previous` (at once when
 * `previous` is null), or after `sliceMs` without a change.
 */
const WAIT_SNAPSHOT_JS = `async function (selector, parts, text, previous, sliceMs) {
  const { passesAll } = (${FILTER_MATCHING_JS})([]);
  const textFilter = text === null ? [] : [{ kind: 'has-text', text: text }];
  const visibleFilter = [{ kind: 'visible' }];
  const snapshot = () => {
    const matches = selector === null ? [] : (${DEEP_QUERY_JS})(selector, parts);
    const withText = matches.filter((el) => passesAll(el, textFilter));
    return {
      count: matches.length,
      textCount: withText.length,
      visibleCount: withText.filter((el) => passesAll(el, visibleFilter)).length,
      readyState: document.readyState
    };
  };
  const changed = (s) => previous === null || s.count !== previous.count ||
    s.textCount !== previous.textCount || s.visibleCount !== previous.visibleCount ||
    s.readyState !== previous.readyState;
  let current = snapshot();
  if (changed(current)) return current;
  return await new Promise((resolve) => {
    let scheduled = null;
    const observer = new MutationObserver(() => { if (scheduled === null) scheduled = setTimeout(check, 16); });
    const poll = setInterval(check, 100);
    const slice = setTimeout(finish, sliceMs);
    function check() {
      scheduled = null;
      current = snapshot();
      if (changed(current)) finish();
    }
    function finish() {
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(slice);
      clearTimeout(scheduled);
      document.removeEventListener('readystatechange', check);
      resolve(current);
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    document.addEventListener('readystatechange', check);
  });
}`;

/**
 * Wait until the page meets the condition.
 *
 * @param cdp - CDP connection
 * @param params - Condition and timeout
 * @returns What the page showed when it was met, and how long it took
 * @throws CommandError (81) for an invalid selector, (102) when the timeout passed
 */
export async function waitForCondition(
  cdp: CDPConnection,
  params: DomWaitCommand
): Promise<DomWaitData> {
  const condition = waitConditionOf(params);
  const started = Date.now();
  const deadline = started + params.timeout;
  let last: WaitSnapshot | undefined;
  while (Date.now() < deadline) {
    const snapshot = await nextSnapshot(cdp, condition, last ?? null, deadline);
    if (!snapshot) {
      await delay(RETRY_DELAY_MS);
      continue;
    }
    if (isWaitConditionMet(snapshot, condition)) {
      return {
        ...condition,
        elapsedMs: Date.now() - started,
        ...snapshotData(snapshot, condition),
      };
    }
    last = snapshot;
  }
  const err = waitTimeoutError(condition, last, params.timeout);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
}

/**
 * The condition of a request (options that are off left out).
 *
 * @param params - Request
 * @returns Condition
 */
function waitConditionOf(params: DomWaitCommand): WaitCondition {
  return {
    ...filterDefined({ selector: params.selector, text: params.text }),
    ...(params.gone && { gone: true }),
    ...(params.visible && { visible: true }),
    ...(params.load && { load: true }),
  };
}

/**
 * The snapshot as reported: `textCount` only when a text was given.
 *
 * @param snapshot - What the page showed
 * @param condition - What was waited for
 * @returns Snapshot fields of the result
 */
function snapshotData(
  snapshot: WaitSnapshot,
  condition: WaitCondition
): Pick<DomWaitData, 'count' | 'textCount' | 'visibleCount' | 'readyState'> {
  return {
    count: snapshot.count,
    ...(condition.text !== undefined && { textCount: snapshot.textCount }),
    visibleCount: snapshot.visibleCount,
    readyState: snapshot.readyState,
  };
}

/**
 * Ask the page for its next snapshot.
 *
 * @param cdp - CDP connection
 * @param condition - What is waited for
 * @param previous - Last snapshot (null for the first call)
 * @param deadline - When the wait ends (epoch ms)
 * @returns The snapshot, or undefined when the page could not answer (navigating, out of time)
 * @throws CommandError (81) for an invalid selector
 */
async function nextSnapshot(
  cdp: CDPConnection,
  condition: WaitCondition,
  previous: WaitSnapshot | null,
  deadline: number
): Promise<WaitSnapshot | undefined> {
  const remaining = deadline - Date.now();
  const selectorArgs =
    condition.selector === undefined ? 'null, null' : selectorArgsJS(condition.selector);
  const text = condition.text === undefined ? null : normalizeWaitText(condition.text);
  const args = `${selectorArgs}, ${JSON.stringify(text)}, ${JSON.stringify(previous)}, ${Math.min(remaining, WAIT_SLICE_MS)}`;
  const evaluated = cdp.send('Runtime.evaluate', {
    expression: `(${WAIT_SNAPSHOT_JS})(${args})`,
    awaitPromise: true,
    returnByValue: true,
  }) as Promise<Protocol.Runtime.EvaluateResponse>;
  evaluated.catch(() => undefined);
  const response = await Promise.race([evaluated, delay(remaining)]).catch((error: unknown) => {
    log.debug(`dom wait: page did not answer (${getErrorMessage(error)}), retrying`);
    return undefined;
  });
  if (!response) return undefined;
  if (response.exceptionDetails) return pageException(response.exceptionDetails, condition);
  return response.result.value as WaitSnapshot;
}

/**
 * Handle an exception of the page script: an invalid selector is the
 * user's; anything else (a document being replaced) is retried.
 *
 * @param details - Exception details
 * @param condition - What is waited for
 * @returns undefined (retry)
 * @throws CommandError (81) for an invalid selector
 */
function pageException(
  details: Protocol.Runtime.ExceptionDetails,
  condition: WaitCondition
): undefined {
  const description = details.exception?.description ?? details.text;
  if (condition.selector !== undefined && description.startsWith('SyntaxError')) {
    const detail = parseSelectorFilters(condition.selector)
      ? undefined
      : description.split('\n')[0];
    const err = invalidSelectorError(condition.selector, detail);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  log.debug(`dom wait: page script failed (${description.split('\n')[0]}), retrying`);
  return undefined;
}
