/**
 * In-process browser session owned by the daemon.
 *
 * A Session launches (or attaches to) Chrome, connects over CDP, runs the
 * telemetry collectors and executes session commands directly. There is no
 * separate worker process: the daemon process *is* the session.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { ChromeLaunchError } from '@/connection/errors.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { CaptureGate, TELEMETRY_READS } from '@/daemon/session/captureGate.js';
import { connectCDP, connectPage, navigateToTarget } from '@/daemon/session/cdpSetup.js';
import {
  externalChromePort,
  findPageTarget,
  setupChromeConnection,
  tabWebSocketUrl,
} from '@/daemon/session/chromeConnection.js';
import { runCleanups, startTelemetryCollectors } from '@/daemon/session/collectors.js';
import {
  createCommandRegistry,
  type CommandRegistry,
  type TabControl,
} from '@/daemon/session/commandRegistry.js';
import { withMatchedStylesReset } from '@/daemon/session/matchedStylesReset.js';
import { telemetryPluginsOf } from '@/daemon/session/plugins.js';
import { TabTracker } from '@/daemon/session/tabs.js';
import { teardownSession, type TeardownContext } from '@/daemon/session/teardown.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { CommandError } from '@/errors/index.js';
import {
  chromeInUseBySessionError,
  lastTabCloseError,
  tabConnectFailedError,
  unknownSessionCommandMessage,
} from '@/errors/messages.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import type { CommandName, CommandSchemas } from '@/ipc/index.js';
import type { PageLoadingState } from '@/ipc/protocol/commands.js';
import type { PageCloseData, PageSwitchData, TabInfo } from '@/ipc/protocol/tabTypes.js';
import type { SessionOptions } from '@/ipc/session/lifecycle.js';
import type { StatusResponseData } from '@/ipc/session/queries.js';
import { applySessionEmulation, type SessionEmulation } from '@/runtime/page/emulation.js';
import { readPageLoadingState } from '@/runtime/page/loadingState.js';
import { findConflictingOwner } from '@/session/chromeOwners.js';
import { reapOrphanedChrome, removeSessionFiles } from '@/session/cleanup/staleSession.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { getSessionPort } from '@/session/port.js';
import { pageCrashedCommandError } from '@/telemetry/pageCrash.js';
import type { CleanupFunction, LaunchedChrome } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { formatChromeNotice } from '@/ui/messages/chrome.js';
import { delay } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';
import { isProcessAlive } from '@/utils/process.js';
import { validateUrl } from '@/utils/url.js';

const log = createLogger('session');

/** Why a session ended. */
export type SessionEndReason = 'normal' | 'crash' | 'timeout' | 'closed';

/** How long Chrome gets to exit after the page connection drops, before the end is called a closed tab */
const CRASH_SETTLE_MS = 500;

/** `Inspector.detached` reason when the page's tab closed */
const TARGET_CLOSED = 'target_closed';

/** Ports tried when automatically chosen ports turn out to be taken */
const PORT_ATTEMPTS = 3;

/**
 * Commands that still work after the page's renderer crashed: they read what
 * the session collected, load the page again (`page reload`/`navigate`),
 * move to or close a tab, or send raw CDP. Every other command needs the page and fails at once.
 */
const RUN_ON_CRASHED_PAGE: ReadonlySet<CommandName> = new Set<CommandName>([
  ...TELEMETRY_READS,
  'page_navigate',
  'page_tabs',
  'page_switch',
  'page_close',
  'cdp_call',
]);

/**
 * CDP methods `bdg cdp` may still send after a renderer crash: loading the
 * page again, and domains the browser process answers. Others wait for the
 * renderer, which never answers.
 */
const CRASH_SAFE_CDP =
  /^(Page\.(navigate|reload|getNavigationHistory|navigateToHistoryEntry)|Target\.|Browser\.|Inspector\.|Network\.(?!getResponseBody|getRequestPostData)|Storage\.|SystemInfo\.)/;

/**
 * Whether a launch failed because another process holds the port.
 *
 * @param error - Launch error
 * @returns True for a PORT_IN_USE launch error
 */
function isPortConflict(error: unknown): boolean {
  return error instanceof ChromeLaunchError && error.issue?.code === 'PORT_IN_USE';
}

/** Summary of a running session, as reported to the CLI on start. */
export interface SessionInfo {
  chromePid: number;
  port: number;
  targetUrl: string;
  targetTitle?: string;
  /** HTTP status of the page's main document, when known */
  documentStatus?: number;
  /** The page had not finished loading when the readiness wait ended */
  loading?: PageLoadingState;
}

/** Session metadata as reported in status responses. */
export type SessionStatusMetadata = NonNullable<StatusResponseData['sessionMetadata']>;

/**
 * A launch that failed because the session was stopped while starting.
 */
export class StartCancelledError extends Error {
  override readonly name = 'StartCancelledError';

  constructor() {
    super('The start was cancelled: the session was stopped while it was starting');
  }
}

/**
 * A running browser session.
 */
export class Session {
  private readonly store = new TelemetryStore();
  private readonly tabs = new TabTracker();
  /** Called with the page connection of each tab the session moves to */
  private readonly pageSwitchListeners: Array<(cdp: CDPConnection) => void> = [];
  /** Settles once the session dealt with a lost page connection (moved to another tab or ended) */
  private readonly pageLosses = new WeakMap<CDPConnection, Promise<void>>();
  /** The tab switch (or close) running; commands wait for it, switches run one at a time */
  private switching: Promise<void> | null = null;
  private readonly registry: CommandRegistry = createCommandRegistry(
    this.store,
    {
      get: () =>
        filterDefined({ viewport: this.config.viewport, colorScheme: this.config.colorScheme }),
      set: (emulation) => this.setEmulation(emulation),
    },
    this.tabControl()
  );
  private readonly captures = new CaptureGate();
  private readonly notify: NoticeSink<ChromeNoticeCode> = (notice) =>
    log.info(formatChromeNotice(notice));
  private chrome: LaunchedChrome | null = null;
  private cdp: CDPConnection | null = null;
  /** Cleanups of the collectors started once for the session */
  private sessionCleanups: CleanupFunction[] = [];
  /** Cleanups of the collectors and tab tracking on the session's tab */
  private pageCleanups: CleanupFunction[] = [];
  private timeoutTimer: NodeJS.Timeout | null = null;
  /** When `--timeout` stops the session (epoch ms) */
  private autoStopAt: number | undefined;
  private stopping: Promise<void> | null = null;
  /** Why the session was first asked to stop ('normal' = user, signal or abandoned start) */
  private stopReason: SessionEndReason | null = null;
  /** Aborted by stop(), so launch steps that wait or retry end at once */
  private readonly launchAbort = new AbortController();
  private started = false;
  private documentRequestId: string | undefined;
  private loading: PageLoadingState | undefined;

  private constructor(
    private config: SessionConfig,
    private readonly onEnded: (reason: SessionEndReason) => void
  ) {}

  /**
   * Validate the request and create a session that has not been launched yet.
   *
   * Synchronous so the caller can register the session (and stop it) before
   * any asynchronous work starts; the CDP port is resolved in {@link launch}.
   *
   * @param url - Target URL
   * @param options - Session options from the start request
   * @param onEnded - Called once when a launched session ends for any reason
   * @returns Unlaunched session
   * @throws CommandError for an invalid URL
   */
  static create(
    url: string,
    options: SessionOptions,
    onEnded: (reason: SessionEndReason) => void
  ): Session {
    const validation = validateUrl(url);
    if (!validation.valid) {
      throw new CommandError(
        validation.error,
        filterDefined({ suggestion: validation.suggestion }),
        EXIT_CODES.INVALID_URL
      );
    }
    return new Session(buildConfig(url, options.port ?? 0, options), onEnded);
  }

  /**
   * Launch: start Chrome (or attach), connect CDP, start collectors, navigate.
   *
   * Every resource is owned by the session as soon as it is acquired, so a
   * concurrent {@link stop} (signal, disconnect) can always release it. On
   * failure or abort, whatever was acquired is released before rethrowing;
   * `onEnded` is only called for sessions that finished launching.
   *
   * @throws Launch/connection errors, or an abort error if stopped meanwhile
   */
  async launch(): Promise<void> {
    try {
      await this.acquireResources();
    } catch (error) {
      const cancelled = this.stopReason === 'normal';
      await this.releaseResources();
      throw cancelled ? new StartCancelledError() : error;
    }
    this.started = true;
    if (this.config.timeout) this.autoStopAt = Date.now() + this.config.timeout * 1000;
    writeSessionMetadata(this.metadata());
    if (this.config.timeout) {
      log.info(`Auto-stop after ${this.config.timeout}s`);
      this.timeoutTimer = setTimeout(() => void this.stop('timeout'), this.config.timeout * 1000);
    }
  }

  /**
   * Execute a registered command against this session. After a renderer
   * crash only {@link RUN_ON_CRASHED_PAGE} commands run (`bdg cdp` only for
   * {@link CRASH_SAFE_CDP} methods); others fail with exit 107 instead of
   * waiting for a page that cannot answer. Commands that may change the page
   * drop `dom inspect`'s kept matched rules ({@link withMatchedStylesReset}).
   * Page commands run once a screenshot running before them has put the
   * page's emulation back ({@link CaptureGate}), on the tab a tab switch
   * running before them moved to.
   *
   * @param name - Command name
   * @param params - Command parameters
   * @param abandoned - Aborted when the requesting client disconnects
   * @returns Command result
   */
  execute<K extends CommandName>(
    name: K,
    params: CommandSchemas[K]['requestSchema'],
    abandoned?: AbortSignal
  ): Promise<CommandSchemas[K]['responseSchema']> {
    if (!this.cdp || !this.started || this.stopping) {
      return Promise.reject(new Error('No active session'));
    }
    const crashedAt = this.store.pageCrashedAt;
    const cdpMethod = name === 'cdp_call' ? (params as { method: string }).method : undefined;
    const needsPage =
      !RUN_ON_CRASHED_PAGE.has(name) ||
      (cdpMethod !== undefined && !CRASH_SAFE_CDP.test(cdpMethod));
    if (crashedAt !== undefined && needsPage) {
      return Promise.reject(pageCrashedCommandError(crashedAt));
    }
    if (!Object.hasOwn(this.registry, name)) {
      return Promise.reject(
        new CommandError(unknownSessionCommandMessage(name), {}, EXIT_CODES.INVALID_ARGUMENTS)
      );
    }
    const handler = this.registry[name];
    return this.captures.run(name, async () => {
      await this.switching;
      const cdp = this.cdp;
      if (!cdp) throw new Error('No active session');
      return withMatchedStylesReset(cdp, name, () => handler(cdp, params, abandoned));
    });
  }

  /**
   * Summary of this session for start responses.
   *
   * @returns Session info
   */
  info(): SessionInfo {
    const target = this.store.targetInfo;
    const documentStatus = this.store.networkRequests.find(
      (request) => request.requestId === this.documentRequestId && request.status
    )?.status;
    return {
      chromePid: this.chrome?.pid ?? 0,
      port: this.config.port,
      targetUrl: target?.url ?? this.config.url,
      ...(target?.title && { targetTitle: target.title }),
      ...(documentStatus !== undefined && { documentStatus }),
      ...(this.loading && { loading: this.loading }),
    };
  }

  /**
   * Metadata for status responses and session-conflict checks.
   *
   * @returns Session metadata
   */
  metadata(): SessionStatusMetadata {
    const target = this.store.targetInfo;
    return {
      bdgPid: process.pid,
      chromePid: this.chrome?.pid ?? 0,
      startTime: this.store.sessionStartTime,
      port: this.config.port,
      activeTelemetry: this.store.activeTelemetry,
      ...filterDefined({
        autoStopAt: this.autoStopAt,
        targetId: target?.id,
        webSocketDebuggerUrl: target?.webSocketDebuggerUrl,
        viewport: this.config.viewport,
        colorScheme: this.config.colorScheme,
      }),
    };
  }

  /**
   * Record a page emulation changed mid-session, so screenshots restore it
   * and `bdg status` reports it.
   *
   * @param emulation - Viewport and color scheme now emulated
   */
  private setEmulation(emulation: SessionEmulation): void {
    const { viewport: _viewport, colorScheme: _colorScheme, ...rest } = this.config;
    this.config = { ...rest, ...emulation };
    this.writeMetadata();
  }

  /**
   * Write the session metadata again after it changed mid-session (emulation, tab).
   */
  private writeMetadata(): void {
    if (!this.started) return;
    try {
      writeSessionMetadata(this.metadata());
    } catch (error) {
      log.debug(`Session metadata not updated: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Whether `bdg cdp Fetch.enable` left requests to pause until continued,
   * which stalls loads and actions (named when a command times out).
   *
   * @returns True while Fetch interception is on
   */
  fetchInterceptionEnabled(): boolean {
    return this.store.fetchInterceptionEnabled;
  }

  /**
   * Whether stop() has been called.
   *
   * @returns True once the session is stopping
   */
  stopRequested(): boolean {
    return this.stopping !== null;
  }

  /**
   * Stop the session: stop collectors, close CDP, terminate Chrome.
   *
   * Idempotent: concurrent and repeated calls share one stop. Safe to call
   * while launching; the launch then aborts and releases what it acquired.
   *
   * @param reason - Why the session is ending
   * @returns Promise resolved when teardown is complete
   */
  stop(reason: SessionEndReason): Promise<void> {
    this.stopReason ??= reason;
    this.launchAbort.abort();
    this.stopping ??= (async () => {
      if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
      log.info(`Stopping session (reason: ${reason})`);
      await this.releaseResources();
      if (!this.started) return;
      removeSessionFiles(process.pid);
      this.onEnded(reason);
    })();
    return this.stopping;
  }

  /**
   * Acquire Chrome, CDP and collectors, checking for a concurrent stop after each step.
   */
  private async acquireResources(): Promise<void> {
    this.store.resetSessionStart();
    const { chromeWsUrl } = this.config;
    if (chromeWsUrl) {
      this.config = { ...this.config, port: externalChromePort(chromeWsUrl) };
      this.throwIfStopping();
      this.chrome = await setupChromeConnection(this.config, this.store, log, this.notify);
    } else {
      await this.launchOwnChrome();
    }
    this.throwIfStopping();
    if (this.chrome) {
      await findPageTarget(this.config, this.store, log);
      this.throwIfStopping();
    }
    this.cdp = await connectCDP(this.store, log, (lost) => this.onPageDisconnected(lost), {
      external: Boolean(chromeWsUrl),
      signal: this.launchAbort.signal,
    });
    this.throwIfStopping();
    await applySessionEmulation(this.cdp, this.config);
    this.throwIfStopping();
    this.sessionCleanups = await startTelemetryCollectors(this.cdp, this.config, this.store, log, {
      plugins: telemetryPluginsOf('session'),
      onPageSwitch: (listener) => void this.pageSwitchListeners.push(listener),
    });
    this.throwIfStopping();
    this.pageCleanups = await this.startPage(this.cdp);
    this.throwIfStopping();
    this.documentRequestId = await navigateToTarget(
      this.cdp,
      this.config,
      this.store,
      this.chrome,
      log
    );
    this.throwIfStopping();
    this.loading = await readPageLoadingState(this.cdp, this.store.pendingNetworkRequests.values());
    this.throwIfStopping();
  }

  /**
   * Choose the port and launch Chrome on it.
   *
   * A Chrome left by this session's crashed daemon is reaped first, so the
   * session gets its remembered port back. If another process took an
   * automatically chosen port before Chrome could listen on it, another port
   * is chosen (the taken one now answers, so it is skipped).
   */
  private async launchOwnChrome(): Promise<void> {
    await reapOrphanedChrome();
    const explicitPort = this.config.port || undefined;
    for (let attempt = 1; ; attempt++) {
      this.config = { ...this.config, port: await getSessionPort(explicitPort) };
      this.throwIfStopping();
      try {
        this.chrome = await setupChromeConnection(
          this.config,
          this.store,
          log,
          this.notify,
          this.launchAbort.signal
        );
        return;
      } catch (error) {
        const retry = !explicitPort && attempt < PORT_ATTEMPTS && isPortConflict(error);
        if (!retry) throw error;
        log.info(`Port ${this.config.port} was taken by another process; choosing another`);
      }
    }
  }

  /**
   * The handlers' view of the session's tabs.
   *
   * @returns Tab control
   */
  private tabControl(): TabControl {
    return {
      list: async () => {
        await this.refreshTabs();
        return { tabs: this.tabs.list() };
      },
      switchTo: (target) => this.switchTab(target),
      close: (target) => this.closeTab(target),
      onPageSwitch: (listener) => void this.pageSwitchListeners.push(listener),
      openedCount: () => this.tabs.openedCount(),
      openedSince: (mark) => this.tabs.openedSince(mark),
      takeClosedSwitch: () => this.tabs.takeClosedSwitch(),
      pageLost: (cdp) => this.pageLosses.get(cdp),
    };
  }

  /**
   * Start what follows the session's tab: the page collectors, noticing the
   * tab closing (Chrome says so before it drops the connection), then tab
   * tracking (a Chrome that refuses target discovery only loses the tab
   * commands).
   *
   * @param cdp - The tab's connection
   * @param switchedTab - A tab the session moved to (not its first)
   * @returns Their cleanups
   */
  private async startPage(cdp: CDPConnection, switchedTab = false): Promise<CleanupFunction[]> {
    const cleanups = await startTelemetryCollectors(cdp, this.config, this.store, log, {
      plugins: telemetryPluginsOf('page'),
      switchedTab,
    });
    const targetId = this.store.targetInfo?.id ?? '';
    cleanups.push(
      cdp.on<{ reason: string }>('Inspector.detached', ({ reason }, sessionId) => {
        if (sessionId === undefined && reason === TARGET_CLOSED) this.onPageDisconnected(cdp, true);
      })
    );
    try {
      cleanups.push(await this.tabs.attach(cdp, targetId));
    } catch (error) {
      this.tabs.setCurrent(targetId);
      log.info(`Tabs not tracked: ${getErrorMessage(error)}`);
    }
    return cleanups;
  }

  /**
   * Read the tabs again; the list stays as the events left it when Chrome
   * does not answer.
   */
  private async refreshTabs(): Promise<void> {
    try {
      if (this.cdp) await this.tabs.refresh(this.cdp);
    } catch (error) {
      log.debug(`Tabs not read: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Run a tab switch or close after the one before it; commands wait for it.
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

  /**
   * `bdg page switch`: make another tab the session's.
   *
   * @param target - Index, target id or part of the URL
   * @returns The tab switched to, and the one before
   */
  private switchTab(target: string): Promise<PageSwitchData> {
    return this.exclusive(async () => {
      await this.refreshTabs();
      const tab = this.tabs.resolve(target);
      if (tab.current) return { tab };
      const previous = this.tabs.current();
      await this.movePage(tab);
      const previousRef = previous && this.tabs.ref(previous.targetId);
      return {
        tab: this.tabs.current() ?? tab,
        ...(previousRef && { previous: previousRef }),
      };
    });
  }

  /**
   * `bdg page close`: close a tab; closing the session's own moves the
   * session to its opener, the tab used before it or another tab first.
   *
   * @param target - Index, target id or part of the URL (the session's tab when absent)
   * @returns The closed tab and the session's tab now
   * @throws CommandError (81) when the session's tab is the only one
   */
  private closeTab(target: string | undefined): Promise<PageCloseData> {
    return this.exclusive(async () => {
      await this.refreshTabs();
      const tab = target === undefined ? this.tabs.current() : this.tabs.resolve(target);
      if (!tab) throw new Error('No tab is known');
      const fallback = tab.current ? this.tabs.fallbackFor(tab.targetId, true) : undefined;
      if (tab.current && !fallback) {
        const err = lastTabCloseError();
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }
      if (fallback) await this.movePage(fallback);
      await this.cdp?.send('Target.closeTarget', { targetId: tab.targetId });
      this.tabs.remove(tab.targetId);
      const current = this.tabs.current();
      if (!current) throw new Error('No tab is current');
      return {
        closed: this.tabs.ref(tab.targetId) ?? tab,
        current,
        ...(fallback && { switched: true as const }),
      };
    });
  }

  /**
   * Point the session at another tab: connect to it, move the page
   * collectors, tab tracking, emulation and `bdg cdp --listen` there, then
   * let go of the old tab's connection. When the new tab cannot be set up
   * and the old connection is still open, the session stays on the old tab.
   *
   * @param tab - The tab
   * @throws CommandError when the tab cannot be reached or another bdg session drives it
   */
  private async movePage(tab: TabInfo): Promise<void> {
    const old = this.cdp;
    const oldTarget = this.store.targetInfo;
    if (!oldTarget) throw new Error('No page target');
    await this.assertTabFree(tab.targetId, oldTarget.webSocketDebuggerUrl);
    const wsUrl = tabWebSocketUrl(oldTarget.webSocketDebuggerUrl, tab.targetId);
    const next = await connectPage(wsUrl, log, (lost) => this.onPageDisconnected(lost)).catch(
      (error: unknown) => {
        const attached = Boolean(this.config.chromeWsUrl);
        const err = tabConnectFailedError(tab.url, getErrorMessage(error), attached);
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.CDP_CONNECTION_FAILURE
        );
      }
    );
    await runCleanups(this.pageCleanups, log);
    this.pageCleanups = [];
    this.pointAt(next, {
      ...oldTarget,
      id: tab.targetId,
      url: tab.url,
      title: tab.title,
      webSocketDebuggerUrl: wsUrl,
    });
    try {
      await applySessionEmulation(next, this.config);
      this.pageCleanups = await this.startPage(next, true);
    } catch (error) {
      next.close();
      if (!old?.isConnected()) throw error;
      this.pointAt(old, oldTarget);
      this.pageCleanups = await this.startPage(old, true);
      throw error;
    }
    old?.close();
    this.pageSwitchListeners.forEach((listener) => listener(next));
    void next
      .send('Page.bringToFront')
      .catch((error: unknown) => log.debug(`Tab not brought to front: ${getErrorMessage(error)}`));
    this.writeMetadata();
    log.info(`Switched to tab ${tab.url} (${tab.targetId})`);
  }

  /**
   * Make a connection the session's page connection.
   *
   * @param cdp - Connection
   * @param target - Its target
   */
  private pointAt(cdp: CDPConnection, target: NonNullable<TelemetryStore['targetInfo']>): void {
    this.cdp = cdp;
    this.store.setTargetInfo(target);
    this.store.pageCrashedAt = undefined;
    this.store.fetchInterceptionEnabled = false;
  }

  /**
   * Refuse a tab of an attached Chrome that another bdg session drives.
   *
   * @param targetId - The tab
   * @param pageWsUrl - WebSocket URL of the session's page (for the message)
   * @throws CommandError (90) naming the other session
   */
  private async assertTabFree(targetId: string, pageWsUrl: string): Promise<void> {
    if (!this.config.chromeWsUrl) return;
    const ids = this.tabs.list().map((tab) => tab.targetId);
    const owner = await findConflictingOwner(ids, targetId);
    if (owner?.targetId !== targetId) return;
    const { protocol, host } = new URL(pageWsUrl);
    const endpoint = `${protocol === 'wss:' ? 'https' : 'http'}://${host}`;
    const err = chromeInUseBySessionError(endpoint, owner);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_CONFLICT
    );
  }

  /**
   * A page connection was lost, or its tab closed. For the session's own
   * tab, the session moves to the tab's opener (or the tab used before it)
   * when the tab closed, else ends; connections the session already left,
   * and ones already handled, are ignored.
   *
   * @param lost - The connection
   * @param tabClosed - Chrome said the tab closed (`Inspector.detached`)
   */
  private onPageDisconnected(lost: CDPConnection, tabClosed = false): void {
    if (this.pageLosses.has(lost) || (this.started && lost !== this.cdp)) return;
    const handled = this.started
      ? this.exclusive(() => this.recoverFromLostTab(tabClosed))
      : this.endAfterDisconnect();
    this.pageLosses.set(
      lost,
      handled.catch(() => undefined)
    );
  }

  /**
   * After the session's tab connection was lost: when Chrome is still
   * running and the tab has an open opener (or a tab used before it), move
   * there and note the switch for the next action result; otherwise end as
   * before ({@link endAfterDisconnect}).
   *
   * @param tabClosed - Chrome said the tab closed, so Chrome need not be given time to exit
   */
  private async recoverFromLostTab(tabClosed: boolean): Promise<void> {
    if (this.chrome && !tabClosed) await delay(CRASH_SETTLE_MS);
    const chromeAlive = this.chrome === null || isProcessAlive(this.chrome.pid);
    const closedId = this.store.targetInfo?.id;
    const fallback = chromeAlive && closedId ? this.tabs.fallbackFor(closedId) : undefined;
    if (closedId && fallback && !this.stopping) {
      try {
        this.tabs.remove(closedId);
        await this.movePage(fallback);
        this.tabs.recordClosedSwitch(closedId, fallback.targetId);
        log.info(`The session's tab closed; switched to ${fallback.url}`);
        return;
      } catch (error) {
        log.info(`Could not switch to ${fallback.url}: ${getErrorMessage(error)}`);
      }
    }
    await this.endAfterDisconnect();
  }

  /**
   * End the session after its page connection was lost. A launched Chrome
   * still running a moment later means the tab was closed (e.g.
   * `Target.closeTarget`), a normal end; otherwise Chrome went away (a
   * crashing Chrome can drop the connection just before it exits).
   */
  private async endAfterDisconnect(): Promise<void> {
    if (this.chrome) await delay(CRASH_SETTLE_MS);
    const tabClosed = this.chrome !== null && isProcessAlive(this.chrome.pid);
    if (tabClosed) log.info('The page was closed; ending the session');
    await this.stop(tabClosed ? 'closed' : 'crash');
  }

  /**
   * Abort a launch that was stopped while in progress.
   *
   * @throws Error if the session is stopping
   */
  private throwIfStopping(): void {
    if (this.stopping) {
      throw new Error('Session was stopped during startup');
    }
  }

  /**
   * Release every resource currently held. Each resource is released once:
   * later calls only release what was acquired since.
   */
  private async releaseResources(): Promise<void> {
    const context: TeardownContext = {
      chrome: this.chrome,
      cdp: this.cdp,
      cleanupFunctions: [...this.pageCleanups, ...this.sessionCleanups],
      external: Boolean(this.config.chromeWsUrl),
      log,
      notify: this.notify,
    };
    this.chrome = null;
    this.cdp = null;
    this.pageCleanups = [];
    this.sessionCleanups = [];
    await teardownSession(context);
  }
}

/**
 * Build the session configuration from a start request.
 *
 * @param url - Target URL
 * @param port - Resolved CDP port
 * @param options - Session options from the start request
 * @returns Session configuration
 */
function buildConfig(url: string, port: number, options: SessionOptions): SessionConfig {
  return {
    url,
    port,
    telemetry: options.telemetry ?? ['network', 'console', 'dom'],
    includeAll: options.includeAll ?? false,
    headless: options.headless ?? false,
    ...filterDefined({
      timeout: options.timeout,
      userDataDir: options.userDataDir,
      maxBodySize: options.maxBodySize,
      chromeWsUrl: options.chromeWsUrl,
      chromeFlags: options.chromeFlags,
      viewport: options.viewport,
      colorScheme: options.colorScheme,
      dialog: options.dialog,
    }),
  };
}
