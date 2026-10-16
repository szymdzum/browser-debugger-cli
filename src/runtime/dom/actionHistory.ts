/**
 * What a page changes on its own between DOM actions (#774): the only thing
 * bdg leaves running on the page between actions. A MutationObserver notes,
 * per changed element, when the page changed it while no action's watch
 * (`EFFECTS_START_SCRIPT`) was running; the next action's watch treats
 * the elements the page kept changing right before it as "changing before
 * the action": their changes do not keep the action "still changing", and
 * their messages are reported under `Also changing:` instead of `New text:`.
 *
 * The cut is the moment the action's watch starts in the page, by the page's
 * own clock, so how fast bdg or Chrome deliver the action does not move it.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** How far back the changes that mark an element are counted (ms) */
const HISTORY_MS = 8000;

/** Changes (separate observer deliveries) within {@link HISTORY_MS} that mark an element */
const MIN_IDLE_CHANGES = 3;

/** How recent the last of those changes must be when the action starts (ms) */
const HISTORY_RECENT_MS = 3000;

/** Change times kept per element */
const TIMES_PER_ELEMENT = 4;

/** Elements with repeated changes kept as candidates (the most recent ones) */
const MAX_HOT_ELEMENTS = 64;

/**
 * Page script that starts the history, left in `window.__bdgHistory` (once
 * per document): a MutationObserver on the document (child lists and text,
 * not attributes, not inside shadow roots) that notes, per element changed
 * (a text node's parent), the time of each delivery that changed it, the
 * last {@link TIMES_PER_ELEMENT}, unless an action's watch is running.
 * Elements changed in two deliveries or more are kept as candidates, at most
 * {@link MAX_HOT_ELEMENTS}, the most recently changed (elements no longer in
 * the document are dropped first when there are more, so a removed subtree
 * is not kept alive). `selfUpdating(now)`
 * lists the candidates still in the document changed in at least
 * {@link MIN_IDLE_CHANGES} deliveries within {@link HISTORY_MS} before `now`,
 * the last within {@link HISTORY_RECENT_MS}. `churned` holds the nodes the
 * page put in place of others on its own: once the document is parsed, the
 * nodes added to an element it had changed in an earlier delivery, and text
 * nodes whose text it changed there (a ticker's replaced `<span>` or text);
 * the next action's watch adds the ones such an element gets in place of
 * churned ones, and leaves churned nodes out of the box text it compares
 * (`otherText`) and of its change count. Added to new documents, it also
 * runs in iframes; only the top frame's history is read (actions watch the
 * top document).
 */
export const HISTORY_START_SCRIPT = `(() => {
  if (window.__bdgHistory) return true;
  const times = new WeakMap();
  const hot = new Set();
  const churned = new WeakSet();
  const note = (records) => {
    const watch = window.__bdgEffects;
    if (watch && !watch.stopped) return;
    const now = performance.now();
    for (const record of records) {
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!el) continue;
      let list = times.get(el);
      if (!list) times.set(el, (list = []));
      const changedEarlier = list.length > 1 || (list.length === 1 && list[0] !== now);
      if (changedEarlier && document.readyState !== 'loading') {
        if (record.type === 'characterData') churned.add(record.target);
        else for (const node of record.addedNodes) churned.add(node);
      }
      if (list[list.length - 1] === now) continue;
      list.push(now);
      if (list.length > ${TIMES_PER_ELEMENT}) list.shift();
      if (list.length < 2) continue;
      hot.delete(el);
      hot.add(el);
      if (hot.size <= ${MAX_HOT_ELEMENTS}) continue;
      for (const kept of hot) if (!kept.isConnected) hot.delete(kept);
      if (hot.size > ${MAX_HOT_ELEMENTS}) hot.delete(hot.values().next().value);
    }
  };
  const observer = new MutationObserver(note);
  observer.observe(document, { subtree: true, childList: true, characterData: true });
  window.__bdgHistory = {
    churned: churned,
    selfUpdating: (now) => Array.from(hot).filter((el) => {
      const recent = (times.get(el) || []).filter((time) => now - time <= ${HISTORY_MS});
      return el.isConnected && recent.length >= ${MIN_IDLE_CHANGES} &&
        now - recent[recent.length - 1] <= ${HISTORY_RECENT_MS};
    }),
    stop: () => observer.disconnect()
  };
  return true;
})()`;

/** Stops the history {@link HISTORY_START_SCRIPT} left */
const HISTORY_STOP_SCRIPT =
  'if (window.__bdgHistory) { window.__bdgHistory.stop(); delete window.__bdgHistory; }';

/**
 * Keep the history on the connection's page: in every document it loads from
 * now on, and in the current one (a page bdg attached to or switched to,
 * whose first action then sees only what changed since). Failures are
 * logged: actions then work as without it.
 *
 * @param cdp - The page's connection
 * @returns Cleanup that stops it on the page and in later documents, settled once both are answered
 */
export async function startActionHistory(cdp: CDPConnection): Promise<CleanupFunction> {
  let identifier: string | undefined;
  try {
    const added = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: HISTORY_START_SCRIPT,
    })) as { identifier?: string };
    identifier = added.identifier;
    await cdp.send('Runtime.evaluate', { expression: HISTORY_START_SCRIPT });
  } catch (error) {
    log.debug(`Action history not started: ${getErrorMessage(error)}`);
  }
  return async () => {
    const stops = [
      ...(identifier ? [cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })] : []),
      cdp.send('Runtime.evaluate', { expression: HISTORY_STOP_SCRIPT }),
    ];
    for (const stop of await Promise.allSettled(stops)) {
      if (stop.status === 'rejected') {
        log.debug(`Action history not stopped: ${getErrorMessage(stop.reason)}`);
      }
    }
  };
}
