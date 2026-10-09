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
import { Session, StartCancelledError, type SessionEndReason } from '@/daemon/session/Session.js';
import { detectTargetMismatch } from '@/daemon/session/targetMismatch.js';
import { CommandError } from '@/errors/index.js';
import {
  LAUNCHED_CHROME_DESCRIPTION,
  cdpRequestRejectedError,
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
import { clearLastSessionEnd, writeLastSessionEnd } from '@/session/lastSession.js';
import { createLogger } from '@/ui/logging/index.js';
import { fetchInterceptionTimeoutCause } from '@/ui/messages/cdpEvents.js';
import { formatChromeIssue } from '@/ui/messages/chrome.js';
import { noActiveSessionMessage } from '@/ui/messages/sessionCommand.js';
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

/** A session command that ran out of time */
class CommandTimeoutError extends Error {
  override readonly name = 'CommandTimeoutError';
}

/**
 * Run a promise with a timeout, clearing the timer either way.
 *
 * @param promise - Work to wait for
 * @param timeoutMs - Timeout in milliseconds
 * @param label - Operation name for the timeout message
 * @returns The promise's result
 * @throws Error when the timeout elapses first
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CommandTimeoutError(`${label} timeout (${timeoutMs / 1000}s)`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
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
        data.starting = { url: this.launching.url, since: this.launching.since };
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
      return { ...base, status: 'ok', data };
    } catch (error) {
      return { ...base, status: 'error', data, error: getErrorMessage(error) };
    }
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
        }),
        QUERY_TIMEOUT_MS,
        'Peek'
      );
      return {
        ...base,
        status: 'ok',
        data: {
          sessionPid: process.pid,
          preview: {
            version: data.version,
            success: true,
            timestamp: new Date(data.startTime).toISOString(),
            duration: data.duration,
            target: data.target,
            data: { network: data.network, console: data.console },
            totals: {
              network: data.totalNetwork,
              console: data.totalConsole,
              ...(data.droppedConsole && { consoleDropped: data.droppedConsole }),
              ...(data.droppedNetwork && { networkDropped: data.droppedNetwork }),
              ...(data.evictedNetworkBodies && { networkBodiesEvicted: data.evictedNetworkBodies }),
            },
            currentNavigationId: data.currentNavigationId,
            ...(data.pageCrashedAt !== undefined && { pageCrashedAt: data.pageCrashedAt }),
            ...(data.downloads && { downloads: data.downloads }),
            partial: true,
          },
        },
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
        execute(name, params, abandoned),
        commandTimeoutMs(name, params),
        'Command'
      );
      return { ...base, status: 'ok', data };
    } catch (error) {
      return { ...base, status: 'error', ...this.describeFailure(error) };
    }
  }

  /**
   * Error fields of a failed session command; a timeout while Fetch
   * interception is on names it, since paused requests stall loads and
   * actions.
   *
   * @param error - Error the command failed with
   * @returns Message, exit code and suggestion
   */
  private describeFailure(error: unknown): ReturnType<typeof describeCommandError> {
    const described = describeCommandError(error);
    if (!(error instanceof CommandTimeoutError) || !this.session?.fetchInterceptionEnabled()) {
      return described;
    }
    const cause = fetchInterceptionTimeoutCause();
    return {
      error: `${described.error}: ${cause.message}`,
      exitCode: EXIT_CODES.CDP_TIMEOUT,
      suggestion: cause.suggestion,
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
      const session = Session.create(url, filterDefined(options), (reason) =>
        this.handleSessionEnded(reason)
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
   */
  private handleSessionEnded(reason: SessionEndReason): void {
    log.info(`Session ended (reason: ${reason})`);
    if (reason !== 'normal') writeLastSessionEnd(reason);
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
        message: `Active session is attached to ${mismatch.current}, not ${mismatch.requested}`,
        errorCode: IPCErrorCode.SESSION_TARGET_MISMATCH,
        existingSession: { ...existingSession, ...(current && { targetUrl: current }) },
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
  };
}
