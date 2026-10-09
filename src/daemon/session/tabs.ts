/**
 * The session's view of Chrome's tabs: which page targets exist (in a stable
 * order, so `bdg page tabs` indices keep their meaning), which one the session
 * acts on, which ones opened since a mark (for action results) and which tab
 * the session falls back to when its own closes.
 *
 * Target discovery runs on the session's page connection
 * (`Target.setDiscoverTargets`), which a launched and an attached Chrome
 * both allow; the tracker is attached again to each new page connection.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { tabAmbiguousError, tabIndexOutOfRangeError, tabNotFoundError } from '@/errors/messages.js';
import type {
  OpenedTab,
  OpenedTabKind,
  TabClosedSwitch,
  TabInfo,
  TabRef,
} from '@/ipc/protocol/tabTypes.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

const log = createLogger('session');

/** What Chrome reports about a target (`Target.TargetInfo`), as far as read here */
export interface TargetInfoEvent {
  targetId: string;
  type: string;
  url: string;
  title: string;
  openerId?: string;
  canAccessOpener?: boolean;
  /** Set for prerendered pages and the like, which are not tabs */
  subtype?: string;
}

/** A page target the session knows */
interface Tab {
  targetId: string;
  url: string;
  title: string;
  openerId?: string;
  kind: OpenedTabKind;
}

/** What the tracker needs of a connection */
type TargetSource = Pick<CDPConnection, 'send' | 'on'>;

/**
 * Whether a target is a tab or window (not a worker, iframe, extension or
 * browser UI page, nor a prerendered page).
 *
 * @param info - Target info
 * @returns True for tabs and windows
 */
function isTab(info: TargetInfoEvent): boolean {
  return info.type === 'page' && info.subtype === undefined;
}

/**
 * The tab a target info describes.
 *
 * @param info - Target info
 * @returns Tab
 */
function toTab(info: TargetInfoEvent): Tab {
  return {
    targetId: info.targetId,
    url: info.url,
    title: info.title,
    ...(info.openerId && { openerId: info.openerId }),
    kind: info.canAccessOpener ? 'popup' : 'tab',
  };
}

/**
 * Parts of URLs a mistyped `bdg page switch <url-part>` may have meant:
 * hosts, path segments (with and without extension) and query values.
 *
 * @param urls - Tab URLs
 * @returns Unique parts
 */
function urlParts(urls: readonly string[]): string[] {
  const parts = new Set<string>();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname) parts.add(parsed.hostname);
      for (const segment of parsed.pathname.split('/')) {
        if (!segment) continue;
        parts.add(segment);
        parts.add(segment.replace(/\.[a-z0-9]+$/i, ''));
      }
      parsed.searchParams.forEach((value) => value && parts.add(value));
    } catch (error) {
      log.debug(`Tab URL not parsed (${url}): ${getErrorMessage(error)}`);
    }
  }
  return [...parts];
}

/**
 * Tracks the tabs of the session's Chrome.
 */
export class TabTracker {
  /** Open tabs in index order: the order bdg first saw them */
  private tabs: Tab[] = [];
  /** Tabs that closed, kept for messages about them */
  private readonly closed = new Map<string, Tab>();
  /**
   * Ids of tabs that closed or are closing: Chrome may still list a tab
   * for a moment after closing it, and target ids are never reused
   */
  private readonly gone = new Set<string>();
  /** Tabs created while the tracker listened, oldest first */
  private readonly opened: string[] = [];
  /** Tabs the session acted on before, most recent last */
  private readonly history: string[] = [];
  /** Switches made because the session's tab closed, oldest first */
  private readonly switches: TabClosedSwitch[] = [];
  /** How many of {@link switches} actions have reported */
  private switchesReported = 0;
  private currentId = '';

  /**
   * Follow the tabs through a page connection: read the open ones, then
   * listen for tabs opening, changing and closing.
   *
   * @param cdp - The session's page connection
   * @param currentId - Target id of the page it is connected to
   * @returns Stops listening
   */
  async attach(cdp: TargetSource, currentId: string): Promise<() => void> {
    this.setCurrent(currentId);
    const offs = [
      cdp.on<{ targetInfo: TargetInfoEvent }>('Target.targetCreated', ({ targetInfo }, session) => {
        if (session === undefined) this.created(targetInfo);
      }),
      cdp.on<{ targetInfo: TargetInfoEvent }>(
        'Target.targetInfoChanged',
        ({ targetInfo }, session) => {
          if (session === undefined) this.changed(targetInfo);
        }
      ),
      cdp.on<{ targetId: string }>('Target.targetDestroyed', ({ targetId }, session) => {
        if (session === undefined && targetId !== this.currentId) this.remove(targetId);
      }),
    ];
    await this.refresh(cdp);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    return () => offs.forEach((off) => off());
  }

  /**
   * Read the tabs' URLs and titles again (Chrome reports a title set after
   * the page committed without an event).
   *
   * @param cdp - The session's page connection
   */
  async refresh(cdp: Pick<CDPConnection, 'send'>): Promise<void> {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: TargetInfoEvent[];
    };
    this.sync(targetInfos);
  }

  /**
   * Make a tab the session's, remembering the one before.
   *
   * @param targetId - Target id
   */
  setCurrent(targetId: string): void {
    if (targetId === this.currentId) return;
    if (this.currentId) this.history.push(this.currentId);
    this.currentId = targetId;
  }

  /**
   * The open tabs, in index order.
   *
   * @returns Tabs
   */
  list(): TabInfo[] {
    return this.tabs.map((tab, index) => this.info(tab, index));
  }

  /**
   * The session's tab.
   *
   * @returns Its listing, or undefined before the tracker was attached
   */
  current(): TabInfo | undefined {
    return this.list().find((tab) => tab.current);
  }

  /**
   * A tab by id, open or closed, as messages name it.
   *
   * @param targetId - Target id
   * @returns Reference (with its index while open)
   */
  ref(targetId: string): TabRef | undefined {
    const index = this.tabs.findIndex((tab) => tab.targetId === targetId);
    const tab = this.tabs[index] ?? this.closed.get(targetId);
    if (!tab) return undefined;
    return {
      ...(index >= 0 && { index }),
      targetId: tab.targetId,
      url: tab.url,
      title: tab.title,
    };
  }

  /**
   * Find the tab `bdg page switch|close <target>` means: a 0-based index, a
   * target id, or text one tab URL contains (case-insensitive).
   *
   * @param target - What was given
   * @returns The tab
   * @throws CommandError 81 for an index out of range or text several URLs contain; 83 when no URL contains it
   */
  resolve(target: string): TabInfo {
    const tabs = this.list();
    if (/^\d+$/.test(target)) {
      const tab = tabs[Number(target)];
      if (tab) return tab;
      fail(tabIndexOutOfRangeError(Number(target), tabs), EXIT_CODES.INVALID_ARGUMENTS);
    }
    const byId = tabs.find((tab) => tab.targetId.toLowerCase() === target.toLowerCase());
    if (byId) return byId;
    const needle = target.toLowerCase();
    const matches = tabs.filter((tab) => tab.url.toLowerCase().includes(needle));
    const [only] = matches;
    if (only && matches.length === 1) return only;
    if (matches.length > 1) fail(tabAmbiguousError(target, matches), EXIT_CODES.INVALID_ARGUMENTS);
    const similar = findSimilar(target, urlParts(tabs.map((tab) => tab.url)));
    fail(tabNotFoundError(target, tabs, similar), EXIT_CODES.RESOURCE_NOT_FOUND);
  }

  /**
   * The tab to move to when a tab of the session closes: its opener while
   * open, else the tab the session was on before it; with `anyOther` (an
   * explicit `bdg page close`), else the first other tab.
   *
   * @param targetId - The closing tab
   * @param anyOther - Fall back to any other open tab
   * @returns The tab, or undefined when there is none
   */
  fallbackFor(targetId: string, anyOther = false): TabInfo | undefined {
    const tabs = this.list().filter((tab) => tab.targetId !== targetId);
    const byId = (id: string | undefined): TabInfo | undefined =>
      tabs.find((tab) => tab.targetId === id);
    const openerId = (
      this.tabs.find((tab) => tab.targetId === targetId) ?? this.closed.get(targetId)
    )?.openerId;
    const previous = this.history.findLast((id) => byId(id) !== undefined);
    return byId(openerId) ?? byId(previous) ?? (anyOther ? tabs[0] : undefined);
  }

  /**
   * Forget a tab that closed.
   *
   * @param targetId - Target id
   */
  remove(targetId: string): void {
    this.gone.add(targetId);
    const tab = this.tabs.find((candidate) => candidate.targetId === targetId);
    if (!tab) return;
    this.closed.set(targetId, tab);
    this.tabs = this.tabs.filter((candidate) => candidate !== tab);
  }

  /**
   * A mark for {@link openedSince}.
   *
   * @returns Tabs opened so far
   */
  openedCount(): number {
    return this.opened.length;
  }

  /**
   * Tabs and windows opened after a mark, as they are now.
   *
   * @param mark - {@link openedCount} at some moment
   * @returns Opened tabs, oldest first
   */
  openedSince(mark: number): OpenedTab[] {
    return this.opened.slice(mark).flatMap((targetId) => {
      const index = this.tabs.findIndex((tab) => tab.targetId === targetId);
      const tab = this.tabs[index] ?? this.closed.get(targetId);
      if (!tab) return [];
      return [{ url: tab.url, targetId, kind: tab.kind, ...(index >= 0 && { index }) }];
    });
  }

  /**
   * Note that the session moved to another tab because its own closed.
   *
   * @param closedId - The tab that closed
   * @param currentId - The tab the session moved to
   * @returns The switch as reported
   */
  recordClosedSwitch(closedId: string, currentId: string): TabClosedSwitch | undefined {
    const tabClosed = this.ref(closedId);
    const switchedTo = this.ref(currentId);
    if (!tabClosed || !switchedTo) return undefined;
    const record = { tabClosed, switchedTo };
    this.switches.push(record);
    return record;
  }

  /**
   * The latest switch no action reported yet; later calls do not return it again.
   *
   * @returns The switch, or undefined when there was none since the last call
   */
  takeClosedSwitch(): TabClosedSwitch | undefined {
    if (this.switchesReported === this.switches.length) return undefined;
    this.switchesReported = this.switches.length;
    return this.switches.at(-1);
  }

  /**
   * Bring the list up to date with Chrome's targets: tabs gone are dropped,
   * new ones added at the end, oldest first (Chrome lists the newest first),
   * the session's own first when the list is empty.
   *
   * @param infos - Every target
   */
  private sync(infos: readonly TargetInfoEvent[]): void {
    const pages = infos.filter((info) => isTab(info) && !this.gone.has(info.targetId));
    const open = new Set(pages.map((info) => info.targetId));
    for (const tab of this.tabs) {
      if (!open.has(tab.targetId) && tab.targetId !== this.currentId) this.remove(tab.targetId);
    }
    const oldestFirst = [...pages].reverse();
    const ordered =
      this.tabs.length > 0
        ? oldestFirst
        : [
            ...oldestFirst.filter((info) => info.targetId === this.currentId),
            ...oldestFirst.filter((info) => info.targetId !== this.currentId),
          ];
    const known = new Set(this.tabs.map((tab) => tab.targetId));
    for (const info of ordered) {
      if (known.has(info.targetId)) this.changed(info);
      else this.tabs.push(toTab(info));
    }
  }

  /**
   * A target was created: a new tab is added and counted as opened.
   *
   * @param info - Target info
   */
  private created(info: TargetInfoEvent): void {
    const known = this.tabs.some((tab) => tab.targetId === info.targetId);
    if (!isTab(info) || known || this.gone.has(info.targetId)) return;
    this.tabs.push(toTab(info));
    this.opened.push(info.targetId);
    log.debug(`Tab opened: ${info.url || 'about:blank'} (${info.targetId})`);
  }

  /**
   * A target changed (navigated, retitled): its tab is updated.
   *
   * @param info - Target info
   */
  private changed(info: TargetInfoEvent): void {
    const tab = this.tabs.find((candidate) => candidate.targetId === info.targetId);
    if (!tab) return;
    tab.url = info.url;
    tab.title = info.title;
    if (info.openerId) tab.openerId = info.openerId;
  }

  /**
   * A tab's listing.
   *
   * @param tab - Tab
   * @param index - Its index
   * @returns Listing
   */
  private info(tab: Tab, index: number): TabInfo {
    const openedBy = this.tabs.findIndex((candidate) => candidate.targetId === tab.openerId);
    return {
      index,
      targetId: tab.targetId,
      url: tab.url,
      title: tab.title,
      ...(tab.targetId === this.currentId && { current: true as const }),
      ...(openedBy >= 0 && { openedBy }),
    };
  }
}

/**
 * Throw a user-facing error.
 *
 * @param err - Message and suggestion
 * @param exitCode - Exit code
 * @throws CommandError always
 */
function fail(err: { message: string; suggestion: string }, exitCode: number): never {
  throw new CommandError(err.message, { suggestion: err.suggestion }, exitCode);
}
