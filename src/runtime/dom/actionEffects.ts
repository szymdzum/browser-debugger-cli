/**
 * What a DOM action changed on the page: whether it navigated (to a new
 * document or within the same one), which messages appeared, and whether it
 * had no visible effect at all. Costs one page script sent before the action
 * (not waited for: CDP runs it before the action's own scripts) and one read
 * after it, plus a second look 300 ms later when nothing seemed to happen.
 * Worst case, when the page does not answer (a navigation is pending), the
 * snapshot is given up after {@link START_TIMEOUT_MS} and each read after
 * {@link READ_TIMEOUT_MS}.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { ActionEffects, NewMessage, PageNavigation } from '@/ipc/protocol/domTypes.js';
import {
  EFFECTS_READ_SCRIPT,
  EFFECTS_START_SCRIPT,
  EFFECTS_STOP_SCRIPT,
} from '@/runtime/dom/actionEffectsScripts.js';
import {
  listenForActivity,
  type ActivityListener,
  type NavigationEvents,
} from '@/runtime/dom/pageActivity.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay, raceTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Messages reported per action */
const MAX_NEW_MESSAGES = 3;

/** Longest message text reported */
const MAX_MESSAGE_LENGTH = 120;

/** How long collecting waits for the snapshot taken before the action */
const START_TIMEOUT_MS = 200;

/** How long a read after the action may take before its part is skipped */
const READ_TIMEOUT_MS = 250;

/** Second look before claiming "no effect" (late timers, animations) */
const NO_EFFECT_RECHECK_MS = 300;

/**
 * Texts that tick on their own (clocks, counters, countdowns, percentages):
 * digits with separators and at most a time unit, e.g. `12:04:33`, `57%`,
 * `3 s`. Their changes are not reported as new messages.
 */
const TICKING_TEXT = /^[\d\s:.,/%+\-–—()]*\d[\d\s:.,/%+\-–—()]*(ms|s|sec|secs|min|mins|h|am|pm)?$/i;

/** A message element as a page snapshot lists it */
export interface SeenMessage {
  /** Number of the element, stable within its document */
  id: number;
  text: string;
  element: string;
}

/** The page before the action */
interface StartSnapshot {
  href: string;
  messages: SeenMessage[];
}

export type { NavigationEvents };

/** The page after the action */
export interface ReadSnapshot {
  href: string;
  /** The snapshot was gone: a new document */
  fresh: boolean;
  /** DOM changes counted since the start (same document only) */
  changes?: number;
  /** Why "no effect" can't be claimed even without changes */
  uncertain?: string;
  messages: SeenMessage[];
}

/** What the action did besides changing the page, for the "no effect" decision */
export interface OtherActivity {
  /** Requests started during the action */
  requests: number;
  /** Dialogs opened during the action */
  dialogs: number;
  /** A window, tab or download was opened */
  opened: boolean;
}

/**
 * Messages that are new after the action: all of them after a new document
 * loaded; otherwise those whose text is shown more often than before (a
 * re-rendered message with the same text is not new) and those whose
 * element changed its text. Texts that tick on their own
 * ({@link TICKING_TEXT}: clocks, counters) are left out; other elements
 * that change on their own (a rotating banner) are not recognised. Each text
 * is reported once, at most {@link MAX_NEW_MESSAGES}, cut to
 * {@link MAX_MESSAGE_LENGTH} characters.
 *
 * @param before - Messages before the action
 * @param after - Messages after the action
 * @param newDocument - Whether a new document loaded
 * @returns New messages
 */
export function newMessages(
  before: SeenMessage[],
  after: SeenMessage[],
  newDocument: boolean
): NewMessage[] {
  const countTexts = (messages: SeenMessage[]): Map<string, number> => {
    const counts = new Map<string, number>();
    messages.forEach(({ text }) => counts.set(text, (counts.get(text) ?? 0) + 1));
    return counts;
  };
  const beforeCounts = countTexts(before);
  const afterCounts = countTexts(after);
  const textBefore = new Map(before.map((message) => [message.id, message.text]));
  const isNew = (message: SeenMessage): boolean => {
    if (newDocument) return true;
    const previous = textBefore.get(message.id);
    if (previous === message.text) return false;
    if (previous !== undefined) return true;
    return (afterCounts.get(message.text) ?? 0) > (beforeCounts.get(message.text) ?? 0);
  };
  const reported = new Set<string>();
  const result: NewMessage[] = [];
  for (const message of after) {
    if (result.length >= MAX_NEW_MESSAGES) break;
    if (reported.has(message.text) || TICKING_TEXT.test(message.text)) continue;
    if (!isNew(message)) continue;
    reported.add(message.text);
    result.push({ text: cutText(message.text), element: message.element });
  }
  return result;
}

/**
 * Cut a text to {@link MAX_MESSAGE_LENGTH} characters, marking the cut.
 *
 * @param text - Text
 * @returns Text of at most that length
 */
function cutText(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= MAX_MESSAGE_LENGTH) return text;
  return `${characters.slice(0, MAX_MESSAGE_LENGTH - 1).join('')}…`;
}

/**
 * How the page's location changed: a new document committed in the main
 * frame (also when it has the URL it had, as after a form POST that
 * redirects back), or a same-document URL change (history API, hash).
 *
 * Without the URL before the action, a same-document change is reported
 * only when Chrome announced one.
 *
 * @param startHref - URL before the action (undefined when not read)
 * @param read - Page read after the action (undefined when not read)
 * @param events - Main-frame navigation events
 * @returns Navigation, or undefined when the location did not change
 */
export function pageNavigation(
  startHref: string | undefined,
  read: ReadSnapshot | undefined,
  events: NavigationEvents
): PageNavigation | undefined {
  if (events.document) {
    const status = events.statusByLoader.get(events.document.loaderId);
    return {
      url: read?.href ?? events.document.url,
      sameDocument: false,
      ...(status !== undefined && { status }),
    };
  }
  const url = read?.href ?? events.withinDocumentUrl;
  if (url === undefined || url === startHref) return undefined;
  if (startHref === undefined && events.withinDocumentUrl === undefined) return undefined;
  return { url, sameDocument: true };
}

/**
 * Whether an action had no visible effect: the page was read before and
 * after in the same document, it counted no DOM change, nothing made the
 * check uncertain, and no navigation, message, request, dialog or new window
 * happened.
 *
 * @param read - Page read after the action
 * @param effects - Navigation and messages found
 * @param activity - Requests, dialogs and windows during the action
 * @returns True to report `effect: "none"`
 */
export function hadNoEffect(
  read: ReadSnapshot | undefined,
  effects: ActionEffects,
  activity: OtherActivity
): boolean {
  return (
    read !== undefined &&
    !read.fresh &&
    read.changes === 0 &&
    read.uncertain === undefined &&
    effects.navigation === undefined &&
    (effects.messages ?? []).length === 0 &&
    activity.requests === 0 &&
    activity.dialogs === 0 &&
    !activity.opened
  );
}

/** Collects what changed, once the action and its wait are done */
export interface ActionEffectsWatch {
  /**
   * @param options - Dialogs the action opened, and whether to decide "no effect"
   * @returns What changed
   */
  collect(options: { dialogs: number; detectNoEffect: boolean }): Promise<ActionEffects>;
  /** Stop listening and stop the page's watch (always call) */
  dispose(): void;
}

/** One action's watch: the listener, the snapshot before, and whether a read stopped it */
interface Watch {
  cdp: CDPConnection;
  listener: ActivityListener;
  start: Promise<StartSnapshot | undefined>;
  stopConfirmed: boolean;
}

/**
 * Start watching an action's effects: listen for main-frame navigations,
 * document statuses, requests and new windows, and send the page snapshot
 * without waiting for it.
 *
 * @param cdp - CDP connection
 * @returns Watch to collect from after the action
 */
export function watchActionEffects(cdp: CDPConnection): ActionEffectsWatch {
  const watch: Watch = {
    cdp,
    listener: listenForActivity(cdp),
    start: evaluate<StartSnapshot>(cdp, EFFECTS_START_SCRIPT),
    stopConfirmed: false,
  };
  return {
    collect: (options) => collectEffects(watch, options),
    dispose: () => disposeWatch(watch),
  };
}

/**
 * What changed: the navigation (from CDP events even without a snapshot),
 * new messages and, when asked, "no effect" after a second look.
 *
 * @param watch - The action's watch
 * @param options - Dialogs the action opened, and whether to decide "no effect"
 * @returns What changed
 */
async function collectEffects(
  watch: Watch,
  options: { dialogs: number; detectNoEffect: boolean }
): Promise<ActionEffects> {
  const start = await raceTimeout(watch.start, START_TIMEOUT_MS);
  if (!start) return effectsOf(undefined, undefined, watch.listener.events);
  let snapshot = await readPage(watch, false);
  let effects = effectsOf(start, snapshot, watch.listener.events);
  const quiet = (): boolean =>
    hadNoEffect(snapshot, effects, { ...watch.listener.activity(), dialogs: options.dialogs });
  if (!options.detectNoEffect || !quiet()) return effects;
  await delay(NO_EFFECT_RECHECK_MS);
  snapshot = await readPage(watch, true);
  effects = effectsOf(start, snapshot, watch.listener.events);
  return quiet() ? { ...effects, effect: 'none' } : effects;
}

/**
 * Navigation and new messages from the snapshots and CDP events.
 *
 * @param start - Snapshot before the action, if taken
 * @param snapshot - Read after the action, if taken
 * @param events - Main-frame navigation events
 * @returns Effects, without empty parts
 */
function effectsOf(
  start: StartSnapshot | undefined,
  snapshot: ReadSnapshot | undefined,
  events: NavigationEvents
): ActionEffects {
  const navigation = pageNavigation(start?.href, snapshot, events);
  const messages =
    start && snapshot ? newMessages(start.messages, snapshot.messages, snapshot.fresh) : [];
  return {
    ...(navigation && { navigation }),
    ...(messages.length > 0 && { messages }),
  };
}

/**
 * Read the page after the action, unless a main-frame load is pending (the
 * read would wait for the new page). A stopping read that answered stops the
 * page's watch, so disposing need not.
 *
 * @param watch - The action's watch
 * @param stop - Also stop the page's watch
 * @returns The read, or undefined
 */
async function readPage(watch: Watch, stop: boolean): Promise<ReadSnapshot | undefined> {
  if (watch.listener.navigationPending()) return undefined;
  const expression = `(${EFFECTS_READ_SCRIPT})(${stop})`;
  const snapshot = await raceTimeout(
    evaluate<ReadSnapshot>(watch.cdp, expression),
    READ_TIMEOUT_MS
  );
  if (stop && snapshot) watch.stopConfirmed = true;
  return snapshot;
}

/**
 * Stop listening, and stop the page's watch unless a read did. The stop is
 * sent even when the snapshot never answered: CDP runs it after the
 * snapshot, wherever that ran (the page also stops watching on its own
 * after 30 s).
 *
 * @param watch - The action's watch
 */
function disposeWatch(watch: Watch): void {
  watch.listener.dispose();
  if (watch.stopConfirmed) return;
  void watch.cdp
    .send('Runtime.evaluate', { expression: EFFECTS_STOP_SCRIPT })
    .catch((error: unknown) => log.debug(`Effects watch not stopped: ${getErrorMessage(error)}`));
}

/**
 * Evaluate a page script for its value (undefined on an exception or a
 * failed call).
 *
 * @param cdp - CDP connection
 * @param expression - Script
 * @returns Its value, or undefined
 */
async function evaluate<T>(cdp: CDPConnection, expression: string): Promise<T | undefined> {
  try {
    const reply = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string };
    };
    if (!reply.exceptionDetails) return reply.result?.value;
    log.debug(`Effects script failed: ${reply.exceptionDetails.text}`);
  } catch (error) {
    log.debug(`Effects script not run: ${getErrorMessage(error)}`);
  }
  return undefined;
}
