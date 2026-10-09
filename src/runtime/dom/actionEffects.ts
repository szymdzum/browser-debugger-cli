/**
 * What a DOM action changed on the page: whether it navigated (to a new
 * document or within the same one), which messages and elements appeared,
 * whether it had no visible effect at all, and whether the page was still
 * working on the result. Costs one page script sent before the action (not
 * waited for: CDP runs it before the action's own scripts) and one read
 * after it, plus a second look 300 ms later when nothing seemed to happen.
 * While watching, a timer in bdg's world notes the stalls during which the
 * page's tasks could not run ({@link STALL_WATCH_START_SCRIPT}); they do not
 * count as quiet time when deciding whether the DOM kept changing.
 * Worst case, when the page does not answer (a navigation is pending, or a
 * long script runs), the snapshot is given up after {@link START_TIMEOUT_MS}
 * and each read after {@link READ_TIMEOUT_MS}, plus as long again, once per
 * action, to ask whether the page ran a long task ({@link pageAnswer}).
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
  AWAIT_DUE_TIMERS_SCRIPT,
  EFFECTS_READ_SCRIPT,
  EFFECTS_START_SCRIPT,
  EFFECTS_STOP_SCRIPT,
  LONG_TASKS_READ_SCRIPT,
  START_DUE_TIMERS_SCRIPT,
  STALL_READ_SCRIPT,
  STALL_WATCH_START_SCRIPT,
  STALL_WATCH_STOP_SCRIPT,
} from '@/runtime/dom/actionEffectsScripts.js';
import {
  listenForActivity,
  type ActivityListener,
  type NavigationEvents,
} from '@/runtime/dom/pageActivity.js';
import { evaluateInBdgWorld, hasBdgWorld } from '@/runtime/page/bdgWorld.js';
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
 * within {@link BUSY_WINDOW_MS}, the last within {@link BUSY_RECENT_MS} of
 * quiet time ({@link quietMs})
 */
const BUSY_BURSTS = 2;
const BUSY_WINDOW_MS = 500;
const BUSY_RECENT_MS = 150;

/**
 * Quiet time since a single burst under which the DOM still looks busy (ms):
 * the page stalled for most of the time since, so its next change could not
 * come. Higher, a short task after a single render (garbage collection, a
 * layout) would cost every such click a second look.
 */
const LONE_BURST_QUIET_MS = 75;

/**
 * Second look at a DOM that looked busy; it is still changing when it
 * changed again and was never quiet longer than {@link BUSY_RECENT_MS}
 * until then (ms)
 */
const STILL_CHANGING_RECHECK_MS = 250;

/** Resource types of pending requests that mean more content is coming */
const CONTENT_REQUEST_TYPES = new Set(['Document', 'XHR', 'Fetch', 'Script']);

/** Longest message text reported */
const MAX_MESSAGE_LENGTH = 120;

/**
 * How long reading the stalls ({@link STALL_READ_SCRIPT}) may take after a
 * read whose bursts make the stalls matter; without an answer, none are
 * known
 */
const STALLS_READ_TIMEOUT_MS = 100;

/** How long collecting waits for the snapshot taken before the action */
const START_TIMEOUT_MS = 200;

/**
 * How long a read after the action may take before its part is skipped. A
 * read has up to three steps ({@link letDueTimersRun}): setting a timer (up
 * to this), waiting for it (up to {@link DUE_TIMERS_TIMEOUT_MS}) and reading
 * (up to this again), so about 600 ms at worst; a DOM that looks busy is
 * read twice.
 */
const READ_TIMEOUT_MS = 250;

/**
 * How long a read waits for the timer it set once the page has set it,
 * before reading anyway: a 0 ms timer waits for the 0 ms tasks queued before
 * it (measured: under 1 ms on an idle page, 5 ms behind a MessageChannel
 * scheduler, 50 ms behind ten chains of 5 ms tasks), and throttled timers
 * may not run for a second
 */
const DUE_TIMERS_TIMEOUT_MS = 100;

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

/**
 * A stall: a stretch during which the page's tasks could not run (a long
 * task, or a renderer running the page's tasks late), as how long ago it
 * began and ended at a read (ms, `[began, ended]`)
 */
export type StallAges = [number, number];

/** Signs that the page was still working at a read (same document only) */
export interface SettleSignals {
  /** Page time of the read (ms, `performance.now()`) */
  at?: number;
  /** How long ago each recent burst of structural DOM changes was (ms, newest last) */
  burstAges: number[];
  /** Stalls up to the read, oldest first (when its bursts made them matter) */
  stalls?: StallAges[];
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
  /** Console messages logged during the action */
  consoleMessages: number;
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
): { messages: NewMessage[]; more: number } {
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
    if (reported.has(message.text) || TICKING_TEXT.test(message.text)) continue;
    if (!isNew(message)) continue;
    reported.add(message.text);
    result.push({ text: cutText(message.text), element: message.element });
  }
  return {
    messages: result.slice(0, MAX_NEW_MESSAGES),
    more: Math.max(0, result.length - MAX_NEW_MESSAGES),
  };
}

/**
 * Cut a text to {@link MAX_MESSAGE_LENGTH} characters, marking the cut.
 *
 * @param text - Text
 * @returns Text of at most that length
 */
export function cutText(text: string): string {
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
 * Bursts of a read within {@link BUSY_WINDOW_MS} that may make the DOM look
 * busy, else none: at least {@link BUSY_BURSTS} of them, or a single one
 * older than {@link BUSY_RECENT_MS} (quiet since, unless the page stalled
 * and its next change could not come).
 *
 * @param settle - Signals of the read
 * @returns Ages of those bursts (ms), or an empty list
 */
function recentBursts(settle: SettleSignals | undefined): number[] {
  const recent = (settle?.burstAges ?? []).filter((age) => age <= BUSY_WINDOW_MS);
  if (recent.length >= BUSY_BURSTS) return recent;
  return recent.length === 1 && (recent[0] ?? 0) > BUSY_RECENT_MS ? recent : [];
}

/**
 * How long the page was quiet between two moments of a read: the time
 * between them less the stalls in it, during which the page's tasks could
 * not run, so it could not change the DOM either.
 *
 * @param fromAge - Earlier moment, as an age at the read (ms)
 * @param toAge - Later moment, as an age at the read (ms)
 * @param stalls - Stalls of the read (they do not overlap)
 * @returns Quiet time (ms)
 */
export function quietMs(fromAge: number, toAge: number, stalls: StallAges[] = []): number {
  const stalled = stalls.reduce(
    (sum, [began, ended]) => sum + Math.max(0, Math.min(fromAge, began) - Math.max(toAge, ended)),
    0
  );
  return fromAge - toAge - stalled;
}

/**
 * Whether a read's DOM looks busy, worth a second look: at least
 * {@link BUSY_BURSTS} bursts of structural changes within
 * {@link BUSY_WINDOW_MS}, and quiet for at most {@link BUSY_RECENT_MS} since
 * the last ({@link quietMs}: stalls do not count). A single burst older than
 * that counts when the page stalled for most of the time since, quiet for
 * at most {@link LONE_BURST_QUIET_MS}: on a renderer running the page's
 * timers late, a page's second step may not have come by the first read.
 * Text-only changes (clocks) and style changes (animations) are not bursts.
 *
 * @param settle - Signals of the read
 * @returns True when the DOM may still be changing
 */
export function domLooksBusy(settle: SettleSignals | undefined): boolean {
  const recent = recentBursts(settle);
  if (recent.length === 0) return false;
  const limit = recent.length === 1 ? LONE_BURST_QUIET_MS : BUSY_RECENT_MS;
  return quietMs(Math.min(...recent), 0, settle?.stalls) <= limit;
}

/**
 * Whether the DOM kept changing during the second look: at least one new
 * burst since the first read, and no quiet gap longer than
 * {@link BUSY_RECENT_MS} from the last burst the first read saw, through the
 * new ones, to the second read. Stalls in a gap, during which the page's
 * tasks could not run, are not quiet ({@link quietMs}): a page whose steps
 * come 250 ms apart around a 200 ms long task, or whose timers a starved
 * renderer runs 150 ms late, keeps changing. A page changing every 140 ms
 * keeps changing; changes more than 150 ms apart while the page could run,
 * a render that ended over 150 ms before the second read and a poller
 * updating every 300 ms do not. A short render whose last commit came within
 * 150 ms of the second read counts as changing.
 *
 * @param settle - Signals of the second read
 * @param sinceMs - Time since the first read
 * @returns True when the DOM is still changing
 */
export function domKeptChanging(settle: SettleSignals | undefined, sinceMs: number): boolean {
  if (!settle) return false;
  const fresh = settle.burstAges.filter((age) => age < sinceMs);
  if (fresh.length === 0) return false;
  const seen = settle.burstAges.filter((age) => age >= sinceMs);
  const times = [...seen.slice(-1), ...fresh, 0];
  return times
    .slice(1)
    .every((age, i) => quietMs(times[i] ?? age, age, settle.stalls) <= BUSY_RECENT_MS);
}

/**
 * What the page was still working on when the action returned, or undefined
 * when it looked settled: content requests (documents, fetch/XHR, scripts)
 * still pending, a new document still loading, a loading indicator that
 * appeared, a DOM still changing ({@link domKeptChanging}), or a page that
 * did not answer (a long script). A result a timer renders later, with no
 * DOM change before it, is not seen.
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
  const pending: PendingChanges = {
    ...(pendingRequests > 0 && { requests: pendingRequests }),
    ...(work.navigating && { navigation: true as const }),
    ...(settle?.loading && { loading: settle.loading }),
    ...(work.domChanging && { domChanging: true as const }),
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
 * dialog, new window or console message happened.
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
    !activity.opened &&
    activity.consoleMessages === 0
  );
}

/** What collecting looks at besides navigation and messages */
export interface CollectOptions {
  /** Dialogs the action opened */
  dialogs: number;
  /** Console messages logged since the action started, so far */
  consoleMessages: () => number;
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
 * stopped it, whether one got no answer in time and whether the page was
 * asked about long tasks ({@link answeredLate}, once per action)
 */
interface Watch {
  cdp: CDPConnection;
  listener: ActivityListener;
  start: Promise<StartSnapshot | undefined>;
  stopConfirmed: boolean;
  unresponsive: boolean;
  askedLate: boolean;
}

/**
 * Start watching an action's effects: listen for main-frame navigations,
 * document statuses, requests and new windows, send the page snapshot
 * without waiting for it, and start the stall watch in bdg's world. That
 * creates bdg's world for the reads now, while the page is idle (created at
 * the first read, it would wait for a page busy after the action and could
 * leave the read no time to answer).
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
    askedLate: false,
  };
  void evaluateInWorld(watch.cdp, STALL_WATCH_START_SCRIPT, false);
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
  const start = await awaitStart(watch);
  if (!start) {
    return { ...effectsOf(undefined, undefined, watch.listener.events), work: pageWork(watch) };
  }
  const reportShown = options.reportShown === true;
  let snapshot = await readPage(watch, { stop: false, reportShown });
  let effects = effectsOf(start, snapshot, watch.listener.events);
  const quiet = (): boolean =>
    hadNoEffect(snapshot, effects, {
      ...watch.listener.activity(),
      dialogs: options.dialogs,
      consoleMessages: options.consoleMessages(),
    });
  if (options.detectNoEffect && quiet()) {
    await delay(NO_EFFECT_RECHECK_MS);
    snapshot = await readPage(watch, { stop: true, reportShown });
    effects = effectsOf(start, snapshot, watch.listener.events);
    if (quiet()) effects = { ...effects, effect: 'none' };
  }
  const domChanging = options.detectUnsettled === true && (await stillChanging(watch, snapshot));
  return { ...effects, work: pageWork(watch, snapshot, domChanging) };
}

/**
 * The snapshot taken before the action, waiting at most
 * {@link START_TIMEOUT_MS} ({@link pageAnswer}); a snapshot still
 * unanswered then (and no navigation pending) marks the page unresponsive.
 *
 * @param watch - The action's watch
 * @returns The snapshot, or undefined
 */
async function awaitStart(watch: Watch): Promise<StartSnapshot | undefined> {
  const started = await pageAnswer(
    watch,
    watch.start.then((value) => ({ value })),
    START_TIMEOUT_MS
  );
  if (!started) watch.unresponsive = !watch.listener.navigationPending();
  return started?.value;
}

/**
 * The answer of a page script within a time, or within {@link READ_TIMEOUT_MS}
 * more when the page only answered late ({@link answeredLate}): the same
 * script is waited for, not sent again (a read that stopped the page's watch
 * could not be repeated).
 *
 * @param watch - The action's watch
 * @param answer - The script's answer
 * @param ms - Time it gets first
 * @returns The answer, or undefined when the page is busy
 */
async function pageAnswer<T>(watch: Watch, answer: Promise<T>, ms: number): Promise<T | undefined> {
  const first = await raceTimeout(answer, ms);
  if (first !== undefined || !(await answeredLate(watch))) return first;
  return raceTimeout(answer, READ_TIMEOUT_MS);
}

/**
 * Whether a page whose script got no answer in time only answered late: it
 * answers now, within {@link READ_TIMEOUT_MS}, and ran no long task since
 * the watch began ({@link LONG_TASKS_READ_SCRIPT}). The renderer ran the
 * page's tasks late (a starved machine), and CDP runs a page's scripts in
 * the order sent, so the script that got no answer has run by now; a page
 * that ran a long task, or still does not answer, is busy. Asked at most
 * once per action, so a busy or starved page costs at most
 * {@link READ_TIMEOUT_MS} more; not asked while a main-frame load is
 * pending.
 *
 * @param watch - The action's watch
 * @returns True when the page is not busy, only slow
 */
async function answeredLate(watch: Watch): Promise<boolean> {
  if (watch.askedLate || watch.listener.navigationPending()) return false;
  watch.askedLate = true;
  const longTasks = await raceTimeout(
    evaluateInWorld<number | null>(watch.cdp, LONG_TASKS_READ_SCRIPT, false),
    READ_TIMEOUT_MS
  );
  const late = longTasks === 0;
  log.debug(
    late
      ? 'Page answered late without a long task (a slow renderer); waiting for its answer'
      : `Page busy (long tasks: ${longTasks ?? 'no answer'})`
  );
  return late;
}

/**
 * Whether the DOM is still changing: when the last read looked busy
 * ({@link domLooksBusy}), a second read {@link STILL_CHANGING_RECHECK_MS}
 * later must see it keep changing ({@link domKeptChanging}). The time
 * between the reads is the page's own when both have it.
 *
 * @param watch - The action's watch
 * @param snapshot - Last read, if any
 * @returns True when the DOM kept changing
 */
async function stillChanging(watch: Watch, snapshot: ReadSnapshot | undefined): Promise<boolean> {
  const first = snapshot?.settle;
  if (!domLooksBusy(first)) return false;
  const firstRead = Date.now();
  await delay(STILL_CHANGING_RECHECK_MS);
  const recheck = (await readPage(watch, { stop: false, reportShown: false, stalls: true }))
    ?.settle;
  const sinceMs =
    first?.at !== undefined && recheck?.at !== undefined
      ? Math.round(recheck.at - first.at)
      : Date.now() - firstRead;
  const changing = domKeptChanging(recheck, sinceMs);
  log.debug(
    `DOM looked busy (burst ages ${first?.burstAges.join(',')} ms, ` +
      `stalls ${describeStalls(first?.stalls)}); ` +
      `${sinceMs} ms later ${recheck?.burstAges.join(',') ?? 'no answer'}, ` +
      `stalls ${describeStalls(recheck?.stalls)}: ` +
      (changing ? 'still changing' : 'settled')
  );
  return changing;
}

/**
 * Stalls for a debug line: each as `began-ended` ms ago.
 *
 * @param stalls - Stalls of a read
 * @returns Description, `none` without any
 */
function describeStalls(stalls: StallAges[] | undefined): string {
  if (!stalls || stalls.length === 0) return 'none';
  return stalls.map(([began, ended]) => `${began}-${ended}`).join(',');
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
    domChanging,
    unresponsive: watch.unresponsive,
    navigating: watch.listener.navigationPending(),
  };
}

/**
 * Navigation, new messages and shown elements from the snapshots and CDP
 * events. Snapshots a page broke (it replaced the built-ins the snapshot
 * script uses) give the navigation only.
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
  try {
    const { messages, more } =
      start && snapshot
        ? newMessages(start.messages, snapshot.messages, snapshot.fresh)
        : { messages: [], more: 0 };
    const shown = shownElements(snapshot?.shown ?? [], messages);
    return {
      ...(navigation && { navigation }),
      ...(messages.length > 0 && { messages }),
      ...(more > 0 && { moreMessages: more }),
      ...(shown.length > 0 && { shown }),
    };
  } catch (error) {
    log.debug(
      `Page effects not readable (the page replaced built-ins?): ${getErrorMessage(error)}`
    );
    return { ...(navigation && { navigation }) };
  }
}

/**
 * Read the page after the action, unless a main-frame load is pending (the
 * read would wait for the new page). The page first gets to run a timer that
 * fell due meanwhile ({@link letDueTimersRun}); the read itself does not wait
 * for timers. A read whose bursts may make the DOM look busy, and the second
 * look at a DOM that did (`stalls`: its first look's bursts may have left
 * the window by then), also gets the stalls up to it ({@link withStalls}).
 * A stopping read that answered stops the page's watch, so disposing need
 * not. A page that did not answer in time is marked unresponsive.
 *
 * @param watch - The action's watch
 * @param options - Also stop the page's watch; list shown elements; always read stalls
 * @returns The read, or undefined
 */
async function readPage(
  watch: Watch,
  options: { stop: boolean; reportShown: boolean; stalls?: boolean }
): Promise<ReadSnapshot | undefined> {
  if (watch.listener.navigationPending()) return undefined;
  const expression = `(${EFFECTS_READ_SCRIPT})(${options.stop}, ${options.reportShown})`;
  const answered = await letDueTimersRun(watch);
  const answer = answered
    ? await pageAnswer(
        watch,
        evaluate<ReadSnapshot>(watch.cdp, expression).then((value) => ({ value })),
        READ_TIMEOUT_MS
      )
    : undefined;
  if (!answer) watch.unresponsive = !watch.listener.navigationPending();
  const snapshot = answer?.value;
  if (options.stop && snapshot) watch.stopConfirmed = true;
  return snapshot && withStalls(watch.cdp, snapshot, options.stalls === true);
}

/**
 * A read with the stalls up to it, as ages at the read, when asked to or
 * when it has enough recent bursts for them to matter
 * ({@link recentBursts}); other reads (a static page) are returned as they
 * are, without a further page script. Stalls are read right after the read,
 * in bdg's world, within {@link STALLS_READ_TIMEOUT_MS}; page times after
 * the read are cut off.
 *
 * @param cdp - CDP connection
 * @param snapshot - The read
 * @param always - Read stalls whatever the bursts (the second look at a busy DOM)
 * @returns The read, with stalls when known
 */
async function withStalls(
  cdp: CDPConnection,
  snapshot: ReadSnapshot,
  always: boolean
): Promise<ReadSnapshot> {
  const settle = snapshot.settle;
  if (settle?.at === undefined || (!always && recentBursts(settle).length === 0)) return snapshot;
  const at = settle.at;
  const stalls = await raceTimeout(
    evaluateInWorld<Array<[number, number]> | null>(cdp, STALL_READ_SCRIPT, false),
    STALLS_READ_TIMEOUT_MS
  );
  if (!Array.isArray(stalls)) return snapshot;
  const ages = stalls
    .filter(([due]) => due < at)
    .map(([due, ran]): StallAges => [Math.round(at - due), Math.max(0, Math.round(at - ran))]);
  return { ...snapshot, settle: { ...settle, stalls: ages } };
}

/**
 * Let the page run a timer that fell due while it was busy, so a read sees
 * its change: set a 0 ms timer ({@link START_DUE_TIMERS_SCRIPT}), then wait
 * for it at most {@link DUE_TIMERS_TIMEOUT_MS}. Both run in bdg's world, whose
 * `setTimeout` the page cannot replace or fake; its timers share the page's
 * queue. Setting the timer has the read's {@link READ_TIMEOUT_MS}
 * ({@link pageAnswer}); a page that does not answer by then is busy and not
 * read. A page that answers just in time, then keeps its timer waiting the
 * full limit and is slow to read can take about 600 ms (250 + 100 + 250)
 * before the read is given up, more when it only answered late.
 *
 * @param watch - The action's watch
 * @returns False when the page did not answer in time (busy)
 */
async function letDueTimersRun(watch: Watch): Promise<boolean> {
  const started = await pageAnswer(
    watch,
    evaluateInWorld(watch.cdp, START_DUE_TIMERS_SCRIPT, false).then(() => true),
    READ_TIMEOUT_MS
  );
  if (!started) return false;
  await raceTimeout(
    evaluateInWorld(watch.cdp, AWAIT_DUE_TIMERS_SCRIPT, true),
    DUE_TIMERS_TIMEOUT_MS
  );
  return true;
}

/**
 * Evaluate one of bdg's page scripts in bdg's world for its value, failures
 * logged.
 *
 * @param cdp - CDP connection
 * @param expression - Script
 * @param awaitPromise - Wait for the promise it returns
 * @returns Its value, or undefined on an exception or a failed call
 */
async function evaluateInWorld<T = unknown>(
  cdp: CDPConnection,
  expression: string,
  awaitPromise: boolean
): Promise<T | undefined> {
  try {
    const reply = await evaluateInBdgWorld(cdp, { expression, awaitPromise, returnByValue: true });
    if (!reply.exceptionDetails) return reply.result.value as T | undefined;
    log.debug(`bdg world script failed: ${reply.exceptionDetails.text}`);
  } catch (error) {
    log.debug(`bdg world script not run: ${getErrorMessage(error)}`);
  }
  return undefined;
}

/**
 * Stop listening, stop the stall watch and stop the page's watch unless a
 * read did. The page's stop is sent even when the snapshot never answered:
 * CDP runs it after the snapshot, wherever that ran (the page also stops
 * watching on its own after 30 s). The stall watch is not stopped when a new
 * document committed and bdg's world is gone with the old one: its watch
 * went with it, and stopping would only make a new world.
 *
 * @param watch - The action's watch
 */
function disposeWatch(watch: Watch): void {
  const documentGone = watch.listener.events.document !== undefined && !hasBdgWorld(watch.cdp);
  watch.listener.dispose();
  if (!documentGone) void evaluateInWorld(watch.cdp, STALL_WATCH_STOP_SCRIPT, false);
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
