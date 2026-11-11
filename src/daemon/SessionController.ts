/**
 * Daemon request handling for the single in-process session.
 *
 * Maps each client IPC request to a response object. Holds the current
 * {@link Session} and asks the daemon to shut down when the session ends,
 * since the daemon's lifetime is the session's lifetime.
 */

import {
  CDPConnectionError,
  CDPProtocolError,
  ChromeLaunchError,
  ConnectionError,
} from '@/connection/errors.js';
import type { ConnectionLossCause } from '@/connection/types.js';
import { Session, StartCancelledError, type SessionEndReason } from '@/daemon/session/Session.js';
import { shownTabSwitch } from '@/daemon/session/interactions.js';
import { detectTargetMismatch } from '@/daemon/session/targetMismatch.js';
import { CommandError } from '@/errors/index.js';
import {
  LAUNCHED_CHROME_DESCRIPTION,
  cdpRequestRejectedError,
  commandTimeoutSuggestion,
  sessionAlreadyRunningMessage,
  sessionEndedDuringCommandError,
  sessionUnavailableSuggestion,
} from '@/errors/messages.js';
import {
  type CdpCallCommand,
  type ClientRequestUnion,
  type CommandName,
  type HandshakeRequest,
  type HandshakeResponse,
  type HARDataRequest,
  type HARDataResponse,
  type PeekRequest,
  type PeekResponse,
  type StartSessionRequest,
  type StartSessionResponse,
  type StatusRequest,
  type StatusResponse,
  type StatusResponseData,
  type StopSessionRequest,
  type StopSessionResponse,
  IPCErrorCode,
} from '@/ipc/index.js';
import type { PageAction } from '@/ipc/protocol/commands.js';
import type { TabClosedSwitch } from '@/ipc/protocol/tabTypes.js';
import {
  cancelsPendingNavigation,
  navigationPendingCommandError,
  pendingDocument,
  pendingDocumentUrl,
  type PendingDocument,
} from '@/runtime/page/pendingDocument.js';
import { clearLastSessionEnd, writeLastSessionEnd } from '@/session/lastSession.js';
import { createLogger } from '@/ui/logging/index.js';
import { fetchInterceptionTimeoutCause } from '@/ui/messages/cdpEvents.js';
import { formatChromeIssue } from '@/ui/messages/chrome.js';
import { noActiveSessionMessage } from '@/ui/messages/sessionCommand.js';
import { TimeoutError, raceTimeout, withTimeout } from '@/utils/async.js';
import { displayTypedUrl, displayUrl } from '@/utils/displayUrl.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('daemon');

/** Error for requests that need the session while `bdg <url>` is still starting it */
const STARTING_ERROR = 'The session is still starting';
const COMMAND_TIMEOUT_MS = 30000;
const QUERY_TIMEOUT_MS = 5000;
/** Time a command that waits (`dom wait`, `cdp --collect`, `cdp --events --wait`) gets beyond its own wait */
const WAIT_COMMAND_MARGIN_MS = 5000;
/**
 * How long a command may wait on a navigation that was already waiting for
 * the server when the command came, before it fails naming it (#946): Chrome
 * holds the page's commands until the document arrives, so a slow server's
 * answer within this time still lets the command run.
 */
const PENDING_NAVIGATION_GRACE_MS = 5000;
/**
 * Commands a pending navigation does not fail fast: raw CDP (it may reach
 * the browser, which a pending navigation does not hold) and `dom wait`
 * (every form; bounded by its own --timeout, and the way to wait for a
 * navigation an action left loading).
 */
const IGNORE_HELD_NAVIGATION: ReadonlySet<CommandName> = new Set([
  'cdp_call',
  'cdp_events',
  'dom_wait',
]);

/**
 * Whether a command is exempt from failing fast on a pending navigation, and
 * from having a timeout blamed on it: {@link IGNORE_HELD_NAVIGATION}, and
 * `page navigate` / `page reload`, which cancel the pending navigation first
 * (the way out the navigation-pending error suggests).
 *
 * @param name - Command name
 * @param params - Command parameters
 * @returns True when the command waits for the per-command timeout instead
 */
function ignoresHeldNavigation(name: CommandName, params: unknown): boolean {
  if (IGNORE_HELD_NAVIGATION.has(name)) return true;
  return (
    name === 'page_navigate' && cancelsPendingNavigation((params as { action: PageAction }).action)
  );
}

/**
 * How long a command waits by its own options: `dom wait` its --timeout,
 * `bdg cdp --collect` its --timeout, `bdg cdp --events` its --wait.
 *
 * @param name - Command name
 * @param params - Command parameters
 * @returns Milliseconds (0 for commands that do not wait)
 */
function ownWaitMs(name: CommandName, params: unknown): number {
  if (name === 'dom_wait') return (params as { timeout?: number }).timeout ?? 0;
  if (name === 'cdp_call') return (params as CdpCallCommand).collect?.timeoutMs ?? 0;
  if (name === 'cdp_events') return (params as { waitMs?: number }).waitMs ?? 0;
  return 0;
}

/**
 * How long a session command may run: {@link COMMAND_TIMEOUT_MS}, or longer
 * for a command that waits by its own options, so it reports its own
 * timeout.
 *
 * @param name - Command name
 * @param params - Command parameters
 * @returns Timeout in milliseconds
 */
function commandTimeoutMs(name: CommandName, params: unknown): number {
  return Math.max(COMMAND_TIMEOUT_MS, ownWaitMs(name, params) + WAIT_COMMAND_MARGIN_MS);
}

/**
 * Fail a command that came while a navigation waited for the server, when
 * that same navigation still waits {@link PENDING_NAVIGATION_GRACE_MS} later
 * (#946). A navigation that answers meanwhile, or one replaced by a newer one
 * (`bdg page navigate`, a reload), lets the command run on.
 *
 * @param work - The running command
 * @param held - The document request pending when the command came
 * @returns The command's result
 * @throws The navigation-pending error when the same request still waits
 */
function failOnHeldNavigation<T>(work: Promise<T>, held: PendingDocument): Promise<T> {
  return raceTimeout(work, PENDING_NAVIGATION_GRACE_MS, {
    onTimeout: () => {
      if (pendingDocument()?.requestId === held.requestId)
        throw navigationPendingCommandError(held.url);
      return work;
    },
  });
}

/**
 * Describe a session start failure for the client.
 *
 * @param error - Error thrown while starting
 * @returns Human-readable message
 */
function describeStartError(error: unknown): string {
  if (error instanceof ConnectionError && error.issue) {
    return formatChromeIssue(error.issue);
  }
  if (error instanceof CommandError) {
    const suggestion = error.metadata['suggestion'];
    return typeof suggestion === 'string' ? `${error.message}\n${suggestion}` : error.message;
  }
  return getErrorMessage(error);
}

/**
 * Error fields of a failed launch: cancelled by a stop, a start URL that could
 * not be loaded, or a launch failure.
 *
 * @param error - Error the launch failed with
 * @returns Message, IPC error code, and the exit code of a user-facing error
 */
function describeLaunchFailure(
  error: unknown
): Pick<StartSessionResponse, 'message' | 'errorCode' | 'exitCode'> {
  if (error instanceof StartCancelledError) {
    return { message: error.message, errorCode: IPCErrorCode.SESSION_START_CANCELLED };
  }
  const navigationFailed =
    error instanceof CommandError && error.exitCode === EXIT_CODES.INVALID_URL;
  return {
    message: describeStartError(error),
    errorCode: navigationFailed
      ? IPCErrorCode.NAVIGATION_FAILED
      : IPCErrorCode.SESSION_START_FAILED,
    ...(error instanceof CommandError && !navigationFailed && { exitCode: error.exitCode }),
    ...(error instanceof ChromeLaunchError && { exitCode: EXIT_CODES.CHROME_LAUNCH_FAILURE }),
  };
}

/**
 * Owns the daemon's session and answers client requests.
 */
export class SessionController {
  private session: Session | null = null;
  private launching: {
    session: Session | null;
    done: Promise<unknown>;
    url: string;
    since: number;
  } | null = null;
  private closing = false;

  /**
   * @param daemonStartTime - Daemon start timestamp (ms)
   * @param socketPath - Daemon socket path, reported in status
   * @param onSessionEnded - Called once the session has ended or failed to start
   */
  constructor(
    private readonly daemonStartTime: number,
    private readonly socketPath: string,
    private readonly onSessionEnded: (reason: SessionEndReason) => void
  ) {}

  /**
   * Whether no session is running or starting.
   *
   * @returns True if the daemon hosts nothing
   */
  isIdle(): boolean {
    return !this.session && !this.launching;
  }

  /**
   * Reject any further start requests (the daemon is shutting down).
   */
  refuseNewSessions(): void {
    this.closing = true;
  }

  /**
   * Stop the session if one is running or launching (used on daemon shutdown).
   *
   * @returns True if a session was stopped
   */
  async stopActiveSession(): Promise<boolean> {
    this.closing = true;
    const launching = this.launching;
    const session = this.session ?? launching?.session;
    if (!session && !launching) return false;
    await session?.stop('normal');
    await launching?.done;
    await this.session?.stop('normal');
    return true;
  }

  /**
   * Error fields for a request that needs the session when there is none:
   * still starting (85), or none at all (also while an abandoned start is
   * torn down).
   *
   * @returns Error message, plus exit code and suggestion while starting
   */
  private noSessionError(): { error: string; exitCode?: number; suggestion?: string } {
    if (!this.launching || this.closing) return { error: noActiveSessionMessage() };
    return {
      error: STARTING_ERROR,
      exitCode: EXIT_CODES.RESOURCE_BUSY,
      suggestion: sessionUnavailableSuggestion(EXIT_CODES.RESOURCE_BUSY),
    };
  }

  /**
   * Respond to a handshake.
   *
   * @param request - Handshake request
   * @returns Handshake response
   */
  handshake(request: HandshakeRequest): HandshakeResponse {
    return {
      type: 'handshake_response',
      sessionId: request.sessionId,
      status: 'ok',
      message: 'Handshake successful',
    };
  }

  /**
   * Report daemon status, enriched with live session activity when available.
   *
   * @param request - Status request
   * @returns Status response
   */
  async status(request: StatusRequest): Promise<StatusResponse> {
    const data: StatusResponseData = {
      daemonPid: process.pid,
      daemonStartTime: this.daemonStartTime,
      socketPath: this.socketPath,
    };
    const base = { type: 'status_response' as const, sessionId: request.sessionId };
    if (!this.session || this.session.stopRequested()) {
      if (this.launching && !this.closing) {
        data.starting = { url: displayTypedUrl(this.launching.url), since: this.launching.since };
      }
      if (this.session || this.closing) data.ending = true;
      return { ...base, status: 'ok', data };
    }

    data.sessionPid = process.pid;
    data.sessionMetadata = this.session.metadata();
    try {
      const live = await withTimeout(
        this.session.execute('session_status', {}),
        QUERY_TIMEOUT_MS,
        'Status'
      );
      Object.assign(data, {
        activity: live.activity,
        pageState: live.target,
        navigationId: live.navigationId,
      });
      return { ...base, status: 'ok', data, ...this.tabMoved(request.tabMove) };
    } catch (error) {
      return { ...base, status: 'error', data, error: getErrorMessage(error) };
    }
  }

  /**
   * A move of the session to another tab no command reported yet, for a
   * response (given once).
   *
   * @param asked - Whether the request takes it (status and peek ask; the
   *   commands always do)
   * @returns `tabMoved`, or nothing
   */
  private tabMoved(asked: boolean | undefined): { tabMoved?: TabClosedSwitch } {
    const moved = asked === true ? this.session?.takeTabMoveNotice() : undefined;
    return moved ? { tabMoved: shownTabSwitch(moved) } : {};
  }

  /**
   * Return a preview of recent telemetry.
   *
   * @param request - Peek request
   * @returns Peek response
   */
  async peek(request: PeekRequest): Promise<PeekResponse> {
    const base = { type: 'peek_response' as const, sessionId: request.sessionId };
    if (!this.session) {
      return { ...base, status: 'error', ...this.noSessionError() };
    }
    try {
      const data = await withTimeout(
        this.session.execute('session_peek', {
          lastN: request.lastN ?? 10,
          ...(request.only && { only: request.only }),
          ...(request.withHeaders && { withHeaders: true }),
          ...(request.navigationsAfter !== undefined && {
            navigationsAfter: request.navigationsAfter,
          }),
        }),
        QUERY_TIMEOUT_MS,
        'Peek'
      );
      const snapshotAt = new Date(data.startTime + data.duration);
      return {
        ...base,
        status: 'ok',
        data: {
          sessionPid: process.pid,
          preview: {
            version: data.version,
            success: true,
            timestamp: snapshotAt.toISOString(),
            duration: data.duration,
            target: data.target,
            data: {
              network: data.network,
              console: data.console,
              ...(data.issues && { issues: data.issues }),
            },
            totals: {
              network: data.totalNetwork,
              console: data.totalConsole,
              ...(data.droppedConsole && { consoleDropped: data.droppedConsole }),
              ...(data.issues && { issues: data.issues.length }),
              ...(data.droppedIssues && { issuesDropped: data.droppedIssues }),
              ...(data.droppedNetwork && { networkDropped: data.droppedNetwork }),
              ...(data.evictedNetworkBodies && { networkBodiesEvicted: data.evictedNetworkBodies }),
              ...(data.excludedTrackerRequests && {
                networkTrackersExcluded: data.excludedTrackerRequests,
              }),
            },
            currentNavigationId: data.currentNavigationId,
            ...(data.navigations && { navigations: data.navigations }),
            ...(data.fetchInterception && { fetchInterception: data.fetchInterception }),
            ...(data.pageCrashedAt !== undefined && { pageCrashedAt: data.pageCrashedAt }),
            ...(data.failedLoad && { failedLoad: data.failedLoad }),
            ...(data.downloads && { downloads: data.downloads }),
            ...(data.tabSwitch && { tabSwitch: data.tabSwitch }),
            partial: true,
          },
        },
        ...this.tabMoved(request.tabMove),
      };
    } catch (error) {
      return { ...base, status: 'error', error: getErrorMessage(error) };
    }
  }

  /**
   * Return all captured network requests for HAR export.
   *
   * @param request - HAR data request
   * @returns HAR data response
   */
  async harData(request: HARDataRequest): Promise<HARDataResponse> {
    const base = { type: 'har_data_response' as const, sessionId: request.sessionId };
    if (!this.session) {
      return { ...base, status: 'error', ...this.noSessionError() };
    }
    try {
      const data = await withTimeout(
        this.session.execute('session_har_data', {}),
        QUERY_TIMEOUT_MS,
        'HAR data'
      );
      return { ...base, status: 'ok', data: { sessionPid: process.pid, requests: data.requests } };
    } catch (error) {
      return { ...base, status: 'error', error: getErrorMessage(error) };
    }
  }

  /**
   * Execute a session command (dom_*, cdp_call, session_details, ...).
   *
   * @param request - Command request
   * @param abandoned - Aborted when the requesting client disconnects
   * @returns Command response, forwarding exit code and suggestion on failure
   */
  async command(request: ClientRequestUnion, abandoned?: AbortSignal): Promise<unknown> {
    const name = request.type.slice(0, -'_request'.length) as CommandName;
    const base = { type: `${name}_response`, sessionId: request.sessionId };
    if (!this.session) {
      return { ...base, status: 'error', ...this.noSessionError() };
    }
    const { sessionId: _sessionId, type: _type, ...params } = request;
    try {
      const execute = this.session.execute.bind(this.session) as (
        n: CommandName,
        p: unknown,
        a?: AbortSignal
      ) => Promise<unknown>;
      const data = await withTimeout(
        this.failFastWhenHeld(name, params, execute(name, params, abandoned)),
        commandTimeoutMs(name, params),
        'Command'
      );
      return { ...base, status: 'ok', data, ...this.tabMoved(true) };
    } catch (error) {
      return {
        ...base,
        status: 'error',
        ...this.describeFailure(error, name, params),
        ...this.tabMoved(true),
      };
    }
  }

  /**
   * A command that came while a navigation waited for the server, failing
   * fast if it still waits ({@link failOnHeldNavigation}). Commands
   * {@link ignoresHeldNavigation} names, and every command while Fetch
   * interception is on (a paused request may be what the navigation waits
   * for), wait for the per-command timeout.
   *
   * @param name - Command name
   * @param params - Command parameters
   * @param work - The running command
   * @returns The command's result
   */
  private failFastWhenHeld<T>(name: CommandName, params: unknown, work: Promise<T>): Promise<T> {
    const held = pendingDocument();
    if (!held || ignoresHeldNavigation(name, params) || this.session?.fetchInterceptionEnabled()) {
      return work;
    }
    return failOnHeldNavigation(work, held);
  }

  /**
   * Error fields of a failed session command. A per-command timeout exits
   * 102: while Fetch interception is on it names it, since paused requests
   * stall loads and actions; while a navigation waits for the server it
   * names that navigation (#946), unless the command is exempt from the hold
   * ({@link ignoresHeldNavigation}).
   *
   * @param error - Error the command failed with
   * @param name - Command name
   * @param params - Command parameters
   * @returns Message, exit code and suggestion
   */
  private describeFailure(
    error: unknown,
    name: CommandName,
    params: unknown
  ): ReturnType<typeof describeCommandError> {
    if (!(error instanceof TimeoutError)) return describeCommandError(error);
    const cause = this.session?.fetchInterceptionEnabled()
      ? fetchInterceptionTimeoutCause()
      : undefined;
    const pendingUrl = ignoresHeldNavigation(name, params) ? undefined : pendingDocumentUrl();
    if (!cause && pendingUrl !== undefined) {
      return describeCommandError(navigationPendingCommandError(pendingUrl));
    }
    return {
      error: cause ? `${error.message}: ${cause.message}` : error.message,
      exitCode: EXIT_CODES.CDP_TIMEOUT,
      suggestion: cause?.suggestion ?? commandTimeoutSuggestion(),
    };
  }

  /**
   * Start a session, or report the one already running.
   *
   * A start whose client disconnects (Ctrl-C, or a client killed without a
   * clean disconnect) is abandoned: the session is stopped, whether it is
   * still launching or has just started, since nobody learns that it exists.
   * From then on the daemon reports itself shutting down (a new start gets
   * the retryable `SESSION_SHUTTING_DOWN`, status shows the session ending),
   * not starting, while Chrome is torn down.
   *
   * @param request - Start session request
   * @param abandoned - Aborted when the requesting client disconnects
   * @returns Start session response
   */
  async startSession(
    request: StartSessionRequest,
    abandoned?: AbortSignal
  ): Promise<StartSessionResponse> {
    const base = { type: 'start_session_response' as const, sessionId: request.sessionId };
    if (this.session || this.launching || this.closing) {
      return { ...base, status: 'error', ...this.describeExistingSession(request) };
    }

    const launching: NonNullable<SessionController['launching']> = {
      session: null,
      done: Promise.resolve(),
      url: request.url,
      since: Date.now(),
    };
    clearLastSessionEnd();
    const run = this.launchSession(request, (session) => {
      launching.session = session;
    });
    launching.done = run;
    this.launching = launching;
    const stopAbandoned = (): void => {
      log.info('Client disconnected during start; stopping the session');
      this.closing = true;
      void launching.session?.stop('normal');
    };
    abandoned?.addEventListener('abort', stopAbandoned, { once: true });
    try {
      const result = await run;
      if (abandoned?.aborted) await launching.session?.stop('normal');
      return { ...base, ...result };
    } finally {
      abandoned?.removeEventListener('abort', stopAbandoned);
      this.launching = null;
    }
  }

  /**
   * Create and launch a session, mapping the outcome to response fields.
   *
   * @param request - Start session request
   * @param onCreated - Receives the session before launch, so it can be stopped mid-launch
   * @returns Status plus data or error fields for the start response
   */
  private async launchSession(
    request: StartSessionRequest,
    onCreated: (session: Session) => void
  ): Promise<Omit<StartSessionResponse, 'type' | 'sessionId'>> {
    const { type: _type, sessionId: _sessionId, url, ...options } = request;
    try {
      const session = Session.create(url, filterDefined(options), (reason, cause) =>
        this.handleSessionEnded(reason, cause)
      );
      onCreated(session);
      if (this.closing) {
        throw new Error('Daemon is shutting down');
      }
      await session.launch();
      this.session = session;
      const info = session.info();
      log.info(`Session started (Chrome PID ${info.chromePid}, port ${info.port})`);
      return {
        status: 'ok',
        message: 'Session started successfully',
        data: { daemonPid: process.pid, ...info },
      };
    } catch (error) {
      log.info(`Session start failed: ${getErrorMessage(error)}`);
      this.closing = true;
      setImmediate(() => this.onSessionEnded('crash'));
      return { status: 'error', ...describeLaunchFailure(error) };
    }
  }

  /**
   * Stop the running session, or abort one that is still launching.
   *
   * @param request - Stop session request
   * @returns Stop session response
   */
  async stopSession(request: StopSessionRequest): Promise<StopSessionResponse> {
    const base = { type: 'stop_session_response' as const, sessionId: request.sessionId };
    const launching = this.session ? null : this.launching;
    const session = this.session ?? launching?.session;
    if (!session) {
      return {
        ...base,
        status: 'error',
        message: noActiveSessionMessage(),
        errorCode: IPCErrorCode.NO_SESSION,
      };
    }
    const { chromePid } = session.info();
    await session.stop('normal');
    await launching?.done;
    return {
      ...base,
      status: 'ok',
      message: 'Session stopped successfully',
      ...(chromePid > 0 && { chromePid }),
    };
  }

  /**
   * React to the session ending (stop, crash, or timeout).
   *
   * @param reason - Why the session ended
   * @param cause - Why the connection to Chrome was lost (`disconnected`)
   */
  private handleSessionEnded(reason: SessionEndReason, cause?: ConnectionLossCause): void {
    log.info(`Session ended (reason: ${reason}${cause ? `, cause: ${cause}` : ''})`);
    if (reason !== 'normal') writeLastSessionEnd(reason, cause);
    this.session = null;
    this.closing = true;
    this.onSessionEnded(reason);
  }

  /**
   * Build the error part of a start response when a session already exists.
   *
   * @param request - Start session request
   * @returns Error message, code and existing-session details
   */
  private describeExistingSession(
    request: StartSessionRequest
  ): Pick<StartSessionResponse, 'message' | 'errorCode' | 'existingSession'> {
    const shuttingDown = this.closing || Boolean(this.session?.stopRequested());
    if (!this.session || shuttingDown) {
      return shuttingDown
        ? {
            message: 'The previous session is still shutting down. Try again in a moment.',
            errorCode: IPCErrorCode.SESSION_SHUTTING_DOWN,
          }
        : {
            message: 'Session startup already in progress. Wait a moment and try again.',
            errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
          };
    }
    const metadata = this.session.metadata();
    const { targetUrl } = this.session.info();
    const existingSession = {
      pid: process.pid,
      startTime: metadata.startTime,
      duration: Math.floor((Date.now() - metadata.startTime) / 1000),
    };
    const mismatch = detectTargetMismatch(request, metadata);
    if (mismatch) {
      const current =
        mismatch.current === LAUNCHED_CHROME_DESCRIPTION ? undefined : mismatch.current;
      return {
        message: `Active session is attached to ${displayTypedUrl(String(mismatch.current))}, not ${displayTypedUrl(String(mismatch.requested))}`,
        errorCode: IPCErrorCode.SESSION_TARGET_MISMATCH,
        existingSession: {
          ...existingSession,
          ...(current && { targetUrl: displayUrl(current) }),
        },
      };
    }
    return {
      message: sessionAlreadyRunningMessage(process.pid),
      errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
      existingSession: { ...existingSession, targetUrl },
    };
  }
}

/**
 * Convert a command failure into response fields.
 *
 * @param error - Error thrown by the command handler
 * @returns Error message plus exit code and suggestion when known
 */
function describeCommandError(error: unknown): {
  error: string;
  exitCode?: number;
  suggestion?: string;
  errorContext?: Record<string, unknown>;
} {
  if (error instanceof CDPProtocolError && error.isRequestError()) {
    const err = cdpRequestRejectedError(error.message);
    return {
      error: err.message,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      suggestion: err.suggestion,
    };
  }
  if (error instanceof CDPConnectionError) {
    const err = sessionEndedDuringCommandError();
    return {
      error: err.message,
      exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
      suggestion: err.suggestion,
    };
  }
  if (!(error instanceof CommandError)) {
    return { error: getErrorMessage(error) };
  }
  const suggestion = error.metadata['suggestion'];
  return {
    error: error.message,
    exitCode: error.exitCode,
    ...(typeof suggestion === 'string' && { suggestion }),
    ...(error.metadata.errorContext && { errorContext: error.metadata.errorContext }),
  };
}
