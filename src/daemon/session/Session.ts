/**
 * In-process browser session owned by the daemon.
 *
 * A Session launches (or attaches to) Chrome, connects over CDP, runs the
 * telemetry collectors and executes session commands directly. There is no
 * separate worker process: the daemon process *is* the session.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { connectCDP, navigateToTarget } from '@/daemon/session/cdpSetup.js';
import {
  externalChromePort,
  findPageTarget,
  setupChromeConnection,
} from '@/daemon/session/chromeConnection.js';
import { startTelemetryCollectors } from '@/daemon/session/collectors.js';
import { createCommandRegistry, type CommandRegistry } from '@/daemon/session/commandRegistry.js';
import { teardownSession, type TeardownContext } from '@/daemon/session/teardown.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { CommandError } from '@/errors/index.js';
import type { ChromeNoticeCode, NoticeSink } from '@/errors/notices.js';
import type { CommandName, CommandSchemas } from '@/ipc/index.js';
import type { SessionOptions } from '@/ipc/session/lifecycle.js';
import type { StatusResponseData } from '@/ipc/session/queries.js';
import { killOrphanedChrome, removeSessionFiles } from '@/session/cleanup/staleSession.js';
import { writeSessionMetadata } from '@/session/metadata.js';
import { getSessionPort } from '@/session/port.js';
import type { CleanupFunction, LaunchedChrome } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { formatChromeNotice } from '@/ui/messages/chrome.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';
import { validateUrl } from '@/utils/url.js';

const log = createLogger('session');

/** Why a session ended. */
export type SessionEndReason = 'normal' | 'crash' | 'timeout';

/** Summary of a running session, as reported to the CLI on start. */
export interface SessionInfo {
  chromePid: number;
  port: number;
  targetUrl: string;
  targetTitle?: string;
  /** HTTP status of the page's main document, when known */
  documentStatus?: number;
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
  private readonly registry: CommandRegistry = createCommandRegistry(this.store);
  private readonly notify: NoticeSink<ChromeNoticeCode> = (notice) =>
    log.info(formatChromeNotice(notice));
  private chrome: LaunchedChrome | null = null;
  private cdp: CDPConnection | null = null;
  private cleanupFunctions: CleanupFunction[] = [];
  private timeoutTimer: NodeJS.Timeout | null = null;
  private stopping: Promise<void> | null = null;
  /** Why the session was first asked to stop ('normal' = user, signal or abandoned start) */
  private stopReason: SessionEndReason | null = null;
  /** Aborted by stop(), so launch steps that wait or retry end at once */
  private readonly launchAbort = new AbortController();
  private started = false;
  private documentRequestId: string | undefined;

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
    writeSessionMetadata(this.metadata());
    if (this.config.timeout) {
      log.info(`Auto-stop after ${this.config.timeout}s`);
      this.timeoutTimer = setTimeout(() => void this.stop('timeout'), this.config.timeout * 1000);
    }
  }

  /**
   * Execute a registered command against this session.
   *
   * @param name - Command name
   * @param params - Command parameters
   * @returns Command result
   */
  execute<K extends CommandName>(
    name: K,
    params: CommandSchemas[K]['requestSchema']
  ): Promise<CommandSchemas[K]['responseSchema']> {
    if (!this.cdp || !this.started || this.stopping) {
      return Promise.reject(new Error('No active session'));
    }
    return this.registry[name](this.cdp, params);
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
        targetId: target?.id,
        webSocketDebuggerUrl: target?.webSocketDebuggerUrl,
      }),
    };
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
      removeSessionFiles();
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
    const port = chromeWsUrl
      ? externalChromePort(chromeWsUrl)
      : await getSessionPort(this.config.port || undefined);
    this.config = { ...this.config, port };
    this.throwIfStopping();
    if (!this.config.chromeWsUrl) {
      killOrphanedChrome();
    }
    this.chrome = await setupChromeConnection(this.config, this.store, log, this.notify);
    this.throwIfStopping();
    if (this.chrome) {
      await findPageTarget(this.config, this.store, log);
      this.throwIfStopping();
    }
    this.cdp = await connectCDP(this.store, log, () => void this.stop('crash'), {
      external: Boolean(chromeWsUrl),
      signal: this.launchAbort.signal,
    });
    this.throwIfStopping();
    this.cleanupFunctions = await startTelemetryCollectors(this.cdp, this.config, this.store, log);
    this.throwIfStopping();
    this.documentRequestId = await navigateToTarget(
      this.cdp,
      this.config,
      this.store,
      this.chrome,
      log
    );
    this.throwIfStopping();
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
      cleanupFunctions: this.cleanupFunctions,
      external: Boolean(this.config.chromeWsUrl),
      log,
      notify: this.notify,
    };
    this.chrome = null;
    this.cdp = null;
    this.cleanupFunctions = [];
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
    }),
  };
}
