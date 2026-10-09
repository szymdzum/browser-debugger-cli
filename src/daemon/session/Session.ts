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
} from '@/daemon/session/chromeConnection.js';
import { runCleanups, startTelemetryCollectors } from '@/daemon/session/collectors.js';
import {
  createCommandRegistry,
  type CommandRegistry,
  type TabControl,
} from '@/daemon/session/commandRegistry.js';
import { withMatchedStylesReset } from '@/daemon/session/matchedStylesReset.js';
import { PageSwitcher, type PageHost, type PageStart } from '@/daemon/session/pageSwitcher.js';
import { telemetryPluginsOf } from '@/daemon/session/plugins.js';
import { TabTracker } from '@/daemon/session/tabs.js';
import { teardownSession, type TeardownContext } from '@/daemon/session/teardown.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { CommandError } from '@/errors/index.js';
import { chromeInUseBySessionError, unknownSessionCommandMessage } from '@/errors/messages.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import type { CommandName, CommandSchemas } from '@/ipc/index.js';
import type { PageLoadingState } from '@/ipc/protocol/commands.js';
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
  /** The session's page connection, moved between tabs */
  private readonly pages = new PageSwitcher(this.pageHost());
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
  /** Cleanups of the collectors started once for the session */
  private sessionCleanups: CleanupFunction[] = [];
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
    if (!this.pages.connection || !this.started || this.stopping) {
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
      await this.pages.settled();
      const cdp = this.pages.connection;
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
    const cdp = await connectCDP(this.store, log, (lost) => this.pages.onPageDisconnected(lost), {
      external: Boolean(chromeWsUrl),
      signal: this.launchAbort.signal,
    });
    this.pages.adopt(cdp, []);
    this.throwIfStopping();
    await this.startCollectors(cdp);
    this.documentRequestId = await navigateToTarget(cdp, this.config, this.store, this.chrome, log);
    this.throwIfStopping();
    this.loading = await readPageLoadingState(cdp, this.store.pendingNetworkRequests.values());
    this.throwIfStopping();
  }

  /**
   * Apply the emulation and start the collectors on the session's first tab.
   *
   * @param cdp - Its connection
   */
  private async startCollectors(cdp: CDPConnection): Promise<void> {
    await applySessionEmulation(cdp, this.config);
    this.throwIfStopping();
    this.sessionCleanups = await startTelemetryCollectors(cdp, this.config, this.store, log, {
      plugins: telemetryPluginsOf('session'),
      onPageSwitch: (listener) => void this.pageSwitchListeners.push(listener),
    });
    this.throwIfStopping();
    this.tabs.setCurrent(this.store.targetInfo?.id ?? '');
    this.pages.adopt(cdp, await this.startPage(cdp, { kind: 'first' }));
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
      list: () => this.pages.list(),
      switchTo: (target) => this.pages.switchTo(target),
      close: (target) => this.pages.close(target),
      onPageSwitch: (listener) => void this.pageSwitchListeners.push(listener),
      openedCount: () => this.tabs.openedCount(),
      openedSince: (mark) => this.tabs.openedSince(mark),
      takeClosedSwitch: () => this.tabs.takeClosedSwitch(),
      pageLost: (cdp) => this.pages.pageLost(cdp),
      unavailable: () => this.tabs.unavailable,
    };
  }

  /**
   * What the page switcher needs of the session.
   *
   * @returns Page host
   */
  private pageHost(): PageHost {
    return {
      store: this.store,
      tabs: this.tabs,
      isAttached: () => Boolean(this.config.chromeWsUrl),
      connect: (wsUrl, onLost) => connectPage(wsUrl, log, onLost),
      startPage: (cdp, start) => this.startPage(cdp, start),
      assertTabFree: (targetId, pageWsUrl) => this.assertTabFree(targetId, pageWsUrl),
      chromeRunning: (tabClosed) => this.chromeRunning(tabClosed),
      endAfterLoss: () => this.endAfterDisconnect(),
      endBroken: () => this.stop('crash'),
      switched: (cdp) => this.switchedTo(cdp),
      isStarted: () => this.started,
      isStopping: () => this.stopping !== null,
    };
  }

  /**
   * Start what follows the session tab: the emulation (on a tab switched
   * to), the page collectors, noticing the tab closing (Chrome says so
   * before it drops the connection) and tab tracking. A tab switched to
   * without tab tracking fails the switch; on the first tab (or the tab a
   * failed switch went back to) it is noted, and the tab commands say so.
   *
   * @param cdp - The tab's connection
   * @param start - How the collectors start
   * @returns Their cleanups
   */
  private async startPage(cdp: CDPConnection, start: PageStart): Promise<CleanupFunction[]> {
    if (start.kind === 'switched') await applySessionEmulation(cdp, this.config);
    const cleanups = await startTelemetryCollectors(cdp, this.config, this.store, log, {
      plugins: telemetryPluginsOf('page'),
      pageStart: start,
    });
    cleanups.push(this.watchTabClosing(cdp));
    try {
      cleanups.push(await this.tabs.attach(cdp));
      this.tabs.unavailable = undefined;
    } catch (error) {
      if (start.kind === 'switched') {
        await runCleanups(cleanups, log);
        throw error;
      }
      this.tabs.unavailable = getErrorMessage(error);
      log.info(`Tabs not tracked: ${this.tabs.unavailable}`);
    }
    return cleanups;
  }

  /**
   * Treat the tab closing (`Inspector.detached` with `target_closed`) like
   * its connection being lost, without waiting for the socket to close.
   *
   * @param cdp - The tab's connection
   * @returns Stops watching
   */
  private watchTabClosing(cdp: CDPConnection): CleanupFunction {
    return cdp.on<{ reason: string }>('Inspector.detached', ({ reason }, sessionId) => {
      if (sessionId === undefined && reason === TARGET_CLOSED) {
        this.pages.onPageDisconnected(cdp, true);
      }
    });
  }

  /**
   * The session moved to another tab: let collectors and handlers follow,
   * bring it to the front and record it in the session metadata.
   *
   * @param cdp - The tab's connection
   */
  private switchedTo(cdp: CDPConnection): void {
    this.pageSwitchListeners.forEach((listener) => listener(cdp));
    void cdp
      .send('Page.bringToFront')
      .catch((error: unknown) => log.debug(`Tab not brought to front: ${getErrorMessage(error)}`));
    this.writeMetadata();
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
   * After a lost page connection: whether Chrome still runs. A launched
   * Chrome gets a moment to exit first unless the tab said it closed (a
   * crashing Chrome can drop the connection just before it exits).
   *
   * @param tabClosed - Chrome said the tab closed
   * @returns False when a launched Chrome exited
   */
  private async chromeRunning(tabClosed: boolean): Promise<boolean> {
    if (this.chrome && !tabClosed) await delay(CRASH_SETTLE_MS);
    return this.chrome === null || isProcessAlive(this.chrome.pid);
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
    const page = this.pages.release();
    const context: TeardownContext = {
      chrome: this.chrome,
      cdp: page.cdp,
      cleanupFunctions: [...page.cleanups, ...this.sessionCleanups],
      external: Boolean(this.config.chromeWsUrl),
      log,
      notify: this.notify,
    };
    this.chrome = null;
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
