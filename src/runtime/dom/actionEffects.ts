/**
 * What a DOM action changed on the page: whether it navigated (to a new
 * document or within the same one), which messages appeared, and whether it
 * had no visible effect at all. Costs one page script before the action and
 * one after it (plus a short second look when nothing seemed to happen).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { ActionEffects, NewMessage, PageNavigation } from '@/ipc/protocol/domTypes.js';
import {
  EFFECTS_READ_SCRIPT,
  EFFECTS_START_SCRIPT,
  EFFECTS_STOP_SCRIPT,
} from '@/runtime/dom/actionEffectsScripts.js';
import { createLogger } from '@/ui/logging/index.js';
import { delay, raceTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Messages reported per action */
const MAX_NEW_MESSAGES = 3;

/** Longest message text reported */
const MAX_MESSAGE_LENGTH = 120;

/** How long a page script may take before its part of the report is skipped */
const SCRIPT_TIMEOUT_MS = 1000;

/** Second look before claiming "no effect" (late timers, animations) */
const NO_EFFECT_RECHECK_MS = 300;

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

/** Main-frame navigation events seen during the action */
export interface NavigationEvents {
  /** Last new document committed in the main frame */
  document?: { url: string; loaderId: string };
  /** Last same-document URL change of the main frame */
  withinDocumentUrl?: string;
  /** HTTP status of documents by loader */
  statusByLoader: Map<string, number>;
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
 * element changed its text. Each text is reported once, at most
 * {@link MAX_NEW_MESSAGES}, cut to {@link MAX_MESSAGE_LENGTH} characters.
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
    if (reported.has(message.text) || !isNew(message)) continue;
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
  if (url === undefined || startHref === undefined || url === startHref) return undefined;
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
  /** Stop listening (always call) */
  dispose(): void;
}

/**
 * Start watching an action's effects: listen for main-frame navigations,
 * document statuses, requests and new windows, and snapshot the page.
 *
 * @param cdp - CDP connection
 * @returns Watch to collect from after the action
 */
export async function watchActionEffects(cdp: CDPConnection): Promise<ActionEffectsWatch> {
  const listener = listenForActivity(cdp);
  const start = await evaluate<StartSnapshot>(cdp, EFFECTS_START_SCRIPT);
  let stopped = false;

  const read = async (stop: boolean): Promise<ReadSnapshot | undefined> => {
    if (listener.navigationPending()) return undefined;
    stopped ||= stop;
    return evaluate<ReadSnapshot>(cdp, `(${EFFECTS_READ_SCRIPT})(${stop})`);
  };
  const effectsOf = (snapshot: ReadSnapshot | undefined): ActionEffects => {
    const navigation = pageNavigation(start?.href, snapshot, listener.events);
    const messages =
      start && snapshot ? newMessages(start.messages, snapshot.messages, snapshot.fresh) : [];
    return {
      ...(navigation && { navigation }),
      ...(messages.length > 0 && { messages }),
    };
  };

  return {
    async collect({ dialogs, detectNoEffect }) {
      if (!start) return {};
      let snapshot = await read(false);
      let effects = effectsOf(snapshot);
      const quiet = (): boolean =>
        hadNoEffect(snapshot, effects, { ...listener.activity(), dialogs });
      if (!detectNoEffect || !quiet()) return effects;
      await delay(NO_EFFECT_RECHECK_MS);
      snapshot = await read(true);
      effects = effectsOf(snapshot);
      return quiet() ? { ...effects, effect: 'none' } : effects;
    },
    dispose() {
      listener.dispose();
      if (start && !stopped) {
        void cdp
          .send('Runtime.evaluate', { expression: EFFECTS_STOP_SCRIPT })
          .catch((error: unknown) =>
            log.debug(`Effects watch not stopped: ${getErrorMessage(error)}`)
          );
      }
    },
  };
}

/**
 * Evaluate a page script for its value, giving up after
 * {@link SCRIPT_TIMEOUT_MS} (a pending navigation holds evaluations) or on
 * an exception.
 *
 * @param cdp - CDP connection
 * @param expression - Script
 * @returns Its value, or undefined
 */
async function evaluate<T>(cdp: CDPConnection, expression: string): Promise<T | undefined> {
  const response = cdp
    .send('Runtime.evaluate', { expression, returnByValue: true })
    .then((reply) => {
      const typed = reply as { result?: { value?: T }; exceptionDetails?: { text?: string } };
      if (typed.exceptionDetails)
        log.debug(`Effects script failed: ${typed.exceptionDetails.text}`);
      return typed.exceptionDetails ? undefined : typed.result?.value;
    })
    .catch((error: unknown) => {
      log.debug(`Effects script not run: ${getErrorMessage(error)}`);
      return undefined;
    });
  return raceTimeout(response, SCRIPT_TIMEOUT_MS);
}

/** Live view of the CDP events an action caused */
interface ActivityListener {
  events: NavigationEvents;
  /** Requests started and windows opened so far */
  activity: () => Omit<OtherActivity, 'dialogs'>;
  /** Whether a main-frame load started and has not committed or stopped */
  navigationPending: () => boolean;
  dispose: () => void;
}

/** CDP events read by {@link listenForActivity} */
interface FrameEvent {
  frame: { id: string; parentId?: string; url: string; urlFragment?: string; loaderId: string };
}

/**
 * Listen for the main frame's navigations, document responses, requests
 * and new windows. Events of attached child targets (out-of-process frames,
 * workers) are not main-frame navigations, but their requests count.
 * `Network.enable` is sent without waiting (see `withActionStability`): the
 * session's network collector usually has the domain enabled already.
 *
 * @param cdp - CDP connection
 * @returns Live listener
 */
function listenForActivity(cdp: CDPConnection): ActivityListener {
  const events: NavigationEvents = { statusByLoader: new Map() };
  let requests = 0;
  let opened = false;
  let loading = false;
  const mainFrame = new Set<string>();
  const cleanups = [
    cdp.on<FrameEvent>('Page.frameNavigated', ({ frame }, sessionId) => {
      if (sessionId !== undefined || frame.parentId !== undefined) return;
      mainFrame.add(frame.id);
      loading = false;
      events.document = { url: frame.url + (frame.urlFragment ?? ''), loaderId: frame.loaderId };
    }),
    cdp.on<{ frameId: string; url: string }>(
      'Page.navigatedWithinDocument',
      ({ frameId, url }, sessionId) => {
        if (sessionId === undefined && mainFrame.has(frameId)) events.withinDocumentUrl = url;
      }
    ),
    cdp.on<{ frameId: string }>('Page.frameStartedLoading', ({ frameId }, sessionId) => {
      if (sessionId === undefined && mainFrame.has(frameId)) loading = true;
    }),
    cdp.on<{ frameId: string }>('Page.frameStoppedLoading', ({ frameId }, sessionId) => {
      if (sessionId === undefined && mainFrame.has(frameId)) loading = false;
    }),
    cdp.on<{ type?: string; loaderId?: string; response: { status: number } }>(
      'Network.responseReceived',
      ({ type, loaderId, response }) => {
        if (type === 'Document' && loaderId) events.statusByLoader.set(loaderId, response.status);
      }
    ),
    cdp.on('Network.requestWillBeSent', () => {
      requests++;
    }),
    cdp.on('Page.windowOpen', () => {
      opened = true;
    }),
    cdp.on('Page.downloadWillBegin', () => {
      opened = true;
    }),
  ];
  void cdp
    .send('Network.enable')
    .catch((error: unknown) => log.debug(`Network.enable failed: ${getErrorMessage(error)}`));
  void cdp
    .send('Page.getFrameTree')
    .then((tree) => {
      const id = (tree as { frameTree?: { frame?: { id?: string } } }).frameTree?.frame?.id;
      if (id) mainFrame.add(id);
    })
    .catch((error: unknown) => log.debug(`No frame tree: ${getErrorMessage(error)}`));
  return {
    events,
    activity: () => ({ requests, opened }),
    navigationPending: () => loading,
    dispose: () => cleanups.forEach((cleanup) => cleanup()),
  };
}
