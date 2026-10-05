/**
 * What a DOM action changed on the page: whether it navigated (to a new
 * document or within the same one), which messages and elements appeared,
 * whether it had no visible effect at all, and whether the page was still
 * working on the result. Costs one page script sent before the action (not
 * waited for: CDP runs it before the action's own scripts) and one read
 * after it, plus a second look 300 ms later when nothing seemed to happen.
 * Worst case, when the page does not answer (a navigation is pending, or a
 * long script runs), the snapshot is given up after {@link START_TIMEOUT_MS}
 * and each read after {@link READ_TIMEOUT_MS}.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type {
  ActionEffects,
  NewMessage,
  PageNavigation,
  PendingChanges,
  ShownElement,
  TriggeredRequest,
} from '@/ipc/protocol/domTypes.js';
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

/** Shown elements reported per action */
const MAX_SHOWN_ELEMENTS = 3;

/**
 * Bursts of DOM changes that make the DOM look busy: at least this many
 * within {@link BUSY_WINDOW_MS}, the last within {@link BUSY_RECENT_MS}
 */
const BUSY_BURSTS = 2;
const BUSY_WINDOW_MS = 500;
const BUSY_RECENT_MS = 150;

/** Second look at a DOM that looked busy; it is still changing with {@link BUSY_BURSTS} new bursts by then (ms) */
const STILL_CHANGING_RECHECK_MS = 250;

/** Resource types of pending requests that mean more content is coming */
const CONTENT_REQUEST_TYPES = new Set(['Document', 'XHR', 'Fetch', 'Script']);

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

/** Signs that the page was still working at a read (same document only) */
export interface SettleSignals {
  /** How long ago each recent burst of structural DOM changes was (ms, newest last) */
  burstAges: number[];
  /** Timers the action's handlers started that had not fired */
  timers: number;
  /** A loading indicator shown since the action began, described */
  loading: string | null;
}

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
  /** Whether the page was still working (same document only) */
  settle?: SettleSignals;
  /** Elements the action showed (when asked for) */
  shown?: ShownElement[];
}

/** What collecting saw of the page's work, for {@link pendingChanges} */
export interface PageWork {
  /** Signals of the last read, when there was one in the same document */
  settle?: SettleSignals;
  /** The action changed the DOM */
  changed: boolean;
  /** The DOM kept changing in bursts over a second look ({@link domLooksBusy}) */
  domChanging: boolean;
  /** A read got no answer within its time (a long script) */
  unresponsive: boolean;
  /** A main-frame load was still pending */
  navigating: boolean;
}

/** Effects, plus the page's work for deciding whether it had settled */
export interface CollectedEffects extends ActionEffects {
  work?: PageWork;
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
 * Elements to report as shown: those whose text is not already reported as
 * a new message, at most {@link MAX_SHOWN_ELEMENTS}, texts cut to
 * {@link MAX_MESSAGE_LENGTH} characters.
 *
 * @param shown - Elements the page found shown by the action
 * @param messages - New messages being reported
 * @returns Elements to report
 */
export function shownElements(shown: ShownElement[], messages: NewMessage[]): ShownElement[] {
  const reported = new Set(messages.map((message) => message.text));
  return shown
    .filter((element) => !reported.has(cutText(element.text)))
    .slice(0, MAX_SHOWN_ELEMENTS)
    .map((element) => ({ ...element, text: cutText(element.text) }));
}

/**
 * Whether a read's DOM looks busy, worth a second look: at least
 * {@link BUSY_BURSTS} bursts of structural changes within
 * {@link BUSY_WINDOW_MS}, the last within {@link BUSY_RECENT_MS}. Text-only
 * changes (clocks) and style changes (animations) are not bursts.
 *
 * @param settle - Signals of the read
 * @returns True when the DOM may still be changing
 */
export function domLooksBusy(settle: SettleSignals | undefined): boolean {
  if (!settle) return false;
  const recent = settle.burstAges.filter((age) => age <= BUSY_WINDOW_MS);
  return recent.length >= BUSY_BURSTS && Math.min(...recent) <= BUSY_RECENT_MS;
}

/**
 * Whether the DOM kept changing during the second look: at least
 * {@link BUSY_BURSTS} new bursts within the time since the first read (a
 * render that ends in two commits, or a poller updating once a second, does
 * not count).
 *
 * @param settle - Signals of the second read
 * @param sinceMs - Time since the first read
 * @returns True when the DOM is still changing
 */
export function domKeptChanging(settle: SettleSignals | undefined, sinceMs: number): boolean {
  if (!settle) return false;
  return settle.burstAges.filter((age) => age < sinceMs).length >= BUSY_BURSTS;
}

/**
 * What the page was still working on when the action returned, or undefined
 * when it looked settled: content requests (documents, fetch/XHR, scripts)
 * still pending, a new document still loading, a loading indicator that
 * appeared, a DOM still changing ({@link domKeptChanging}), timers the
 * action's handlers started (only when the action changed nothing yet, so a
 * toast's hide timer does not count), or a page that did not answer (a long
 * script).
 *
 * @param work - What collecting saw
 * @param requests - Requests the action triggered (with pending ones)
 * @returns Pending work, or undefined
 */
export function pendingChanges(
  work: PageWork,
  requests: TriggeredRequest[] = []
): PendingChanges | undefined {
  const settle = work.settle;
  const pendingRequests = requests.filter(
    (request) => request.pending && CONTENT_REQUEST_TYPES.has(request.resourceType ?? '')
  ).length;
  const timers = !work.changed && settle !== undefined ? settle.timers : 0;
  const pending: PendingChanges = {
    ...(pendingRequests > 0 && { requests: pendingRequests }),
    ...(work.navigating && { navigation: true as const }),
    ...(settle?.loading && { loading: settle.loading }),
    ...(work.domChanging && { domChanging: true as const }),
    ...(timers > 0 && { timers }),
    ...(work.unresponsive && { busy: true as const }),
  };
  return Object.keys(pending).length > 0 ? pending : undefined;
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
 * check uncertain, and no navigation, message, shown element, request,
 * dialog or new window happened.
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
    (effects.shown ?? []).length === 0 &&
    activity.requests === 0 &&
    activity.dialogs === 0 &&
    !activity.opened
  );
}

/** What collecting looks at besides navigation and messages */
export interface CollectOptions {
  /** Dialogs the action opened */
  dialogs: number;
  /** Decide "no effect" (with a second look when nothing seemed to happen) */
  detectNoEffect: boolean;
  /** List the elements the action showed */
  reportShown?: boolean;
  /** Take a second look when the DOM looks busy, to tell whether it is still changing */
  detectUnsettled?: boolean;
}

/** Collects what changed, once the action and its wait are done */
export interface ActionEffectsWatch {
  /**
   * @param options - Dialogs, and what to decide and list
   * @returns What changed, and the page's work at the end
   */
  collect(options: CollectOptions): Promise<CollectedEffects>;
  /** Stop listening and stop the page's watch (always call) */
  dispose(): void;
}

/**
 * One action's watch: the listener, the snapshot before, whether a read
 * stopped it and whether one got no answer in time
 */
interface Watch {
  cdp: CDPConnection;
  listener: ActivityListener;
  start: Promise<StartSnapshot | undefined>;
  stopConfirmed: boolean;
  unresponsive: boolean;
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
    unresponsive: false,
  };
  return {
    collect: (options) => collectEffects(watch, options),
    dispose: () => disposeWatch(watch),
  };
}

/**
 * What changed: the navigation (from CDP events even without a snapshot),
 * new messages, shown elements when asked, "no effect" after a second look
 * when asked, and the page's work at the end.
 *
 * @param watch - The action's watch
 * @param options - Dialogs, and what to decide and list
 * @returns What changed
 */
async function collectEffects(watch: Watch, options: CollectOptions): Promise<CollectedEffects> {
  const started = await raceTimeout(
    watch.start.then((value) => ({ value })),
    START_TIMEOUT_MS
  );
  if (!started) watch.unresponsive = !watch.listener.navigationPending();
  const start = started?.value;
  if (!start) {
    return { ...effectsOf(undefined, undefined, watch.listener.events), work: pageWork(watch) };
  }
  const reportShown = options.reportShown === true;
  let snapshot = await readPage(watch, { stop: false, reportShown });
  let effects = effectsOf(start, snapshot, watch.listener.events);
  const quiet = (): boolean =>
    hadNoEffect(snapshot, effects, { ...watch.listener.activity(), dialogs: options.dialogs });
  if (options.detectNoEffect && quiet()) {
    await delay(NO_EFFECT_RECHECK_MS);
    snapshot = await readPage(watch, { stop: true, reportShown });
    effects = effectsOf(start, snapshot, watch.listener.events);
    if (quiet()) effects = { ...effects, effect: 'none' };
  }
  let domChanging = false;
  if (options.detectUnsettled && domLooksBusy(snapshot?.settle)) {
    const firstRead = Date.now();
    await delay(STILL_CHANGING_RECHECK_MS);
    const recheck = await readPage(watch, { stop: false, reportShown: false });
    domChanging = domKeptChanging(recheck?.settle, Date.now() - firstRead);
  }
  return { ...effects, work: pageWork(watch, snapshot, domChanging) };
}

/**
 * The page's work as the last read and the CDP events saw it.
 *
 * @param watch - The action's watch
 * @param snapshot - Last read, if any
 * @param domChanging - Whether the DOM kept changing over a second look
 * @returns Page work
 */
function pageWork(watch: Watch, snapshot?: ReadSnapshot, domChanging = false): PageWork {
  return {
    ...(snapshot?.settle && { settle: snapshot.settle }),
    changed: (snapshot?.changes ?? 0) > 0,
    domChanging,
    unresponsive: watch.unresponsive,
    navigating: watch.listener.navigationPending(),
  };
}

/**
 * Navigation, new messages and shown elements from the snapshots and CDP
 * events.
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
  const shown = shownElements(snapshot?.shown ?? [], messages);
  return {
    ...(navigation && { navigation }),
    ...(messages.length > 0 && { messages }),
    ...(shown.length > 0 && { shown }),
  };
}

/**
 * Read the page after the action, unless a main-frame load is pending (the
 * read would wait for the new page). A stopping read that answered stops the
 * page's watch, so disposing need not. A read that got no answer in time
 * marks the page unresponsive.
 *
 * @param watch - The action's watch
 * @param options - Also stop the page's watch; list shown elements
 * @returns The read, or undefined
 */
async function readPage(
  watch: Watch,
  options: { stop: boolean; reportShown: boolean }
): Promise<ReadSnapshot | undefined> {
  if (watch.listener.navigationPending()) return undefined;
  const expression = `(${EFFECTS_READ_SCRIPT})(${options.stop}, ${options.reportShown})`;
  const answer = await raceTimeout(
    evaluate<ReadSnapshot>(watch.cdp, expression).then((value) => ({ value })),
    READ_TIMEOUT_MS
  );
  if (!answer) watch.unresponsive = !watch.listener.navigationPending();
  const snapshot = answer?.value;
  if (options.stop && snapshot) watch.stopConfirmed = true;
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
