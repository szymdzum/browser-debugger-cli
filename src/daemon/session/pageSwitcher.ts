/**
 * The session's page connection and moving it between tabs (the
 * `bdg page switch` and `bdg page close` commands), and returning to the
 * opener when the session tab closes. Switches run one at a time; commands
 * wait for the one running.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { tabWebSocketUrl } from '@/daemon/session/chromeConnection.js';
import { runCleanups } from '@/daemon/session/collectors.js';
import type { TabTracker } from '@/daemon/session/tabs.js';
import { CommandError } from '@/errors/index.js';
import {
  lastTabCloseError,
  sessionEndedAfterFailedSwitchError,
  tabConnectFailedError,
  tabsUnavailableError,
} from '@/errors/messages.js';
import type {
  PageCloseData,
  PageSwitchData,
  PageTabsData,
  TabInfo,
} from '@/ipc/protocol/tabTypes.js';
import type { PageIssueLog } from '@/telemetry/issues.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type { CDPTarget, CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('session');

/**
 * How the collectors of a tab start: on the session's first tab, on a tab
 * the session moved to (its page is the next navigation), or again on the
 * tab a failed switch went back to (its navigation goes on)
 */
export type PageStart = { kind: 'first' } | { kind: 'switched'; url: string } | { kind: 'resumed' };

/** What the switcher needs of the session */
export interface PageHost {
  store: TelemetryStore;
  tabs: TabTracker;
  /** Attached to a running Chrome (`--chrome-ws-url`) */
  isAttached: () => boolean;
  /** Open a tab's connection; `onLost` is called if it is lost later */
  connect: (wsUrl: string, onLost: (cdp: CDPConnection) => void) => Promise<CDPConnection>;
  /** Start what follows the session tab on a connection (cleans up itself when it fails) */
  startPage: (cdp: CDPConnection, start: PageStart) => Promise<CleanupFunction[]>;
  /** Refuse a tab another bdg session drives */
  assertTabFree: (targetId: string, pageWsUrl: string) => Promise<void>;
  /** After a lost connection: whether Chrome still runs (given time to exit unless the tab said it closed) */
  chromeRunning: (tabClosed: boolean) => Promise<boolean>;
  /** End the session after its tab's connection was lost for good */
  endAfterLoss: () => Promise<void>;
  /** End a session left without a working tab */
  endBroken: () => Promise<void>;
  /** The session moved to another tab's connection */
  switched: (cdp: CDPConnection) => void;
  isStarted: () => boolean;
  isStopping: () => boolean;
}

/** Store state a failed switch puts back */
interface PageSnapshot {
  target: CDPTarget;
  fetchInterception: boolean;
  navigations: number;
  issues: PageIssueLog;
  pending: Array<[string, PendingRequest]>;
}

/**
 * Holds the session's page connection and moves it between tabs.
 */
export class PageSwitcher {
  private cdp: CDPConnection | null = null;
  private cleanups: CleanupFunction[] = [];
  private switching: Promise<void> | null = null;
  /** Settles once the session dealt with a lost connection */
  private readonly losses = new WeakMap<CDPConnection, Promise<void>>();

  /**
   * @param host - The session
   */
  constructor(private readonly host: PageHost) {}

  /** The session's page connection */
  get connection(): CDPConnection | null {
    return this.cdp;
  }

  /**
   * Take a connection and what was started on it as the session's.
   *
   * @param cdp - Page connection
   * @param cleanups - Cleanups of what follows its tab
   */
  adopt(cdp: CDPConnection, cleanups: CleanupFunction[]): void {
    this.cdp = cdp;
    this.cleanups = cleanups;
  }

  /**
   * Give up the connection and cleanups for teardown.
   *
   * @returns What was held
   */
  release(): { cdp: CDPConnection | null; cleanups: CleanupFunction[] } {
    const held = { cdp: this.cdp, cleanups: this.cleanups };
    this.cdp = null;
    this.cleanups = [];
    return held;
  }

  /** Wait for the switch running, if any. */
  async settled(): Promise<void> {
    await this.switching;
  }

  /**
   * When a connection was lost: settles once the session dealt with it.
   *
   * @param cdp - Connection
   * @returns Undefined for a connection that was not lost
   */
  pageLost(cdp: CDPConnection): Promise<void> | undefined {
    return this.losses.get(cdp);
  }

  /**
   * `bdg page tabs`.
   *
   * @returns The tabs, read again
   */
  async list(): Promise<PageTabsData> {
    await this.refresh();
    return { tabs: this.host.tabs.list() };
  }

  /**
   * `bdg page switch`: make another tab the session's.
   *
   * @param target - Index, target id or part of the URL
   * @returns The tab switched to, and the one before
   */
  switchTo(target: string): Promise<PageSwitchData> {
    return this.exclusive(async () => {
      await this.refresh();
      const tab = this.host.tabs.resolve(target);
      if (tab.current) return { tab };
      const previous = this.host.tabs.current();
      await this.move(tab);
      const previousRef = previous && this.host.tabs.ref(previous.targetId);
      return {
        tab: this.host.tabs.current() ?? tab,
        ...(previousRef && { previous: previousRef }),
      };
    });
  }

  /**
   * `bdg page close`: close a tab; closing the session's own moves the
   * session to its opener, the tab used before it or another tab first.
   *
   * @param target - Index, target id or part of the URL (the session tab when absent)
   * @returns The closed tab and the session tab now
   * @throws CommandError (81) when the session tab is the only one
   */
  close(target: string | undefined): Promise<PageCloseData> {
    return this.exclusive(async () => {
      await this.refresh();
      const tabs = this.host.tabs;
      const tab = target === undefined ? tabs.current() : tabs.resolve(target);
      if (!tab) throw new Error('No tab is known');
      const fallback = tab.current ? tabs.fallbackFor(tab.targetId, true) : undefined;
      if (tab.current && !fallback) fail(lastTabCloseError(), EXIT_CODES.INVALID_ARGUMENTS);
      if (fallback) await this.move(fallback);
      await this.cdp?.send('Target.closeTarget', { targetId: tab.targetId });
      tabs.remove(tab.targetId);
      const current = tabs.current();
      if (!current) throw new Error('No tab is current');
      const closed = tabs.ref(tab.targetId) ?? tab;
      return { closed, current, ...(fallback && { switched: true as const }) };
    });
  }

  /**
   * A page connection was lost, or its tab closed. For the session tab, the
   * session moves to the tab's opener (or the tab used before it), else
   * ends; connections the session left, and ones already handled, are
   * ignored, also when the loss waited for a switch away from them.
   *
   * @param lost - The connection
   * @param tabClosed - Chrome said the tab closed (`Inspector.detached`)
   */
  onPageDisconnected(lost: CDPConnection, tabClosed = false): void {
    const started = this.host.isStarted();
    if (this.losses.has(lost) || (started && lost !== this.cdp)) return;
    const handled = started
      ? this.exclusive(() => this.recover(lost, tabClosed))
      : this.host.endAfterLoss();
    this.losses.set(
      lost,
      handled.catch(() => undefined)
    );
  }

  /**
   * After the session tab's connection was lost: return to the tab's opener
   * (or the tab used before it) while Chrome runs, else end the session.
   *
   * @param lost - The lost connection
   * @param tabClosed - Chrome said the tab closed
   */
  private async recover(lost: CDPConnection, tabClosed: boolean): Promise<void> {
    if (lost !== this.cdp) return;
    const running = await this.host.chromeRunning(tabClosed);
    const closedId = this.host.store.targetInfo?.id;
    const fallback =
      running && closedId && !this.host.isStopping()
        ? this.host.tabs.fallbackFor(closedId)
        : undefined;
    if (closedId && fallback && (await this.returnTo(closedId, fallback))) return;
    await this.host.endAfterLoss();
  }

  /**
   * Move to the fallback tab after the session tab closed, noting the switch
   * for the next action result.
   *
   * @param closedId - The tab that closed
   * @param fallback - The tab to move to
   * @returns Whether the session moved
   */
  private async returnTo(closedId: string, fallback: TabInfo): Promise<boolean> {
    try {
      this.host.tabs.markClosed(closedId);
      await this.move(fallback);
      this.host.tabs.recordClosedSwitch(closedId, fallback.targetId);
      log.info(`The session's tab closed; switched to ${fallback.url}`);
      return true;
    } catch (error) {
      log.info(`Could not switch to ${fallback.url}: ${getErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Point the session at another tab: connect to it, stop what follows the
   * old tab, start it on the new one, then let go of the old connection. A
   * failure after connecting puts the old tab back ({@link rollBack}).
   *
   * @param tab - The tab
   */
  private async move(tab: TabInfo): Promise<void> {
    const snapshot = this.snapshot();
    const wsUrl = tabWebSocketUrl(snapshot.target.webSocketDebuggerUrl, tab.targetId);
    await this.host.assertTabFree(tab.targetId, snapshot.target.webSocketDebuggerUrl);
    const next = await this.open(tab, wsUrl);
    await runCleanups(this.cleanups, log);
    this.cleanups = [];
    this.host.store.setTargetInfo({ ...snapshot.target, ...tabTarget(tab, wsUrl) });
    try {
      this.cleanups = await this.host.startPage(next, { kind: 'switched', url: tab.url });
    } catch (error) {
      next.close();
      await this.rollBack(snapshot, error);
      throw error;
    }
    this.commit(next, tab);
  }

  /**
   * Connect to a tab.
   *
   * @param tab - The tab
   * @param wsUrl - Its WebSocket URL
   * @returns Its connection
   * @throws CommandError (101) when it cannot be reached
   */
  private async open(tab: TabInfo, wsUrl: string): Promise<CDPConnection> {
    try {
      return await this.host.connect(wsUrl, (lost) => this.onPageDisconnected(lost));
    } catch (error) {
      const err = tabConnectFailedError(tab.url, getErrorMessage(error), this.host.isAttached());
      return fail(err, EXIT_CODES.CDP_CONNECTION_FAILURE);
    }
  }

  /**
   * Make a set-up tab the session's and let go of the old connection.
   *
   * @param next - The tab's connection
   * @param tab - The tab
   */
  private commit(next: CDPConnection, tab: TabInfo): void {
    const old = this.cdp;
    this.cdp = next;
    this.host.store.pageCrashedAt = undefined;
    this.host.store.fetchInterceptionEnabled = false;
    this.host.tabs.setCurrent(tab.targetId);
    old?.close();
    this.host.switched(next);
    log.info(`Switched to tab ${tab.url} (${tab.targetId})`);
  }

  /**
   * After a failed switch, put back the store state the snapshot took and
   * start again on the old tab while its connection is open. When that
   * fails too, the session ends.
   *
   * @param snapshot - State before the switch
   * @param cause - Why the switch failed
   * @throws CommandError when the session had to end
   */
  private async rollBack(snapshot: PageSnapshot, cause: unknown): Promise<void> {
    this.restore(snapshot);
    const old = this.cdp;
    if (!old?.isConnected()) return;
    try {
      this.cleanups = await this.host.startPage(old, { kind: 'resumed' });
    } catch (error) {
      void this.host.endBroken();
      const err = sessionEndedAfterFailedSwitchError(
        getErrorMessage(cause),
        getErrorMessage(error)
      );
      fail(err, EXIT_CODES.CDP_CONNECTION_FAILURE);
    }
  }

  /**
   * The store state a switch changes.
   *
   * @returns Snapshot
   */
  private snapshot(): PageSnapshot {
    const { store } = this.host;
    if (!store.targetInfo) throw new Error('No page target');
    return {
      target: store.targetInfo,
      fetchInterception: store.fetchInterceptionEnabled,
      navigations: store.navigationEvents.length,
      issues: store.pageIssues,
      pending: [...store.pendingNetworkRequests],
    };
  }

  /**
   * Put the store state back.
   *
   * @param snapshot - State before the switch
   */
  private restore(snapshot: PageSnapshot): void {
    const { store } = this.host;
    store.setTargetInfo(snapshot.target);
    store.fetchInterceptionEnabled = snapshot.fetchInterception;
    store.navigationEvents.length = snapshot.navigations;
    store.pageIssues = snapshot.issues;
    store.pendingNetworkRequests.clear();
    for (const [id, request] of snapshot.pending) {
      store.pendingNetworkRequests.set(id, request);
    }
  }

  /**
   * Read the tabs again (the list stays as the events left it when Chrome
   * does not answer).
   *
   * @throws CommandError when tab tracking is unavailable
   */
  private async refresh(): Promise<void> {
    const { unavailable } = this.host.tabs;
    if (unavailable !== undefined)
      fail(tabsUnavailableError(unavailable), EXIT_CODES.CDP_CONNECTION_FAILURE);
    try {
      if (this.cdp) await this.host.tabs.refresh(this.cdp);
    } catch (error) {
      log.debug(`Tabs not read: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Run a switch after the one before it.
   *
   * @param work - The switch
   * @returns Its result
   */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = (this.switching ?? Promise.resolve()).then(work);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.switching = settled;
    void settled.then(() => {
      if (this.switching === settled) this.switching = null;
    });
    return run;
  }
}

/**
 * The target fields of a tab.
 *
 * @param tab - The tab
 * @param wsUrl - Its WebSocket URL
 * @returns Id, URL, title and WebSocket URL
 */
function tabTarget(tab: TabInfo, wsUrl: string): Omit<CDPTarget, 'type'> {
  return { id: tab.targetId, url: tab.url, title: tab.title, webSocketDebuggerUrl: wsUrl };
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
