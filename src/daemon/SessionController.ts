/**
 * Daemon request handling for the single in-process session.
 *
 * Maps each client IPC request to a response object. Holds the current
 * {@link Session} and asks the daemon to shut down when the session ends,
 * since the daemon's lifetime is the session's lifetime.
 */

import { ConnectionError } from '@/connection/errors.js';
import { Session, StartCancelledError, type SessionEndReason } from '@/daemon/session/Session.js';
import { detectTargetMismatch } from '@/daemon/session/targetMismatch.js';
import { CommandError } from '@/errors/index.js';
import { LAUNCHED_CHROME_DESCRIPTION } from '@/errors/messages.js';
import {
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
import { createLogger } from '@/ui/logging/index.js';
import { formatChromeIssue } from '@/ui/messages/chrome.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('daemon');

const NO_SESSION_ERROR = 'No active session';
const COMMAND_TIMEOUT_MS = 30000;
const QUERY_TIMEOUT_MS = 5000;

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
      () => reject(new Error(`${label} timeout (${timeoutMs / 1000}s)`)),
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
 * @returns Message and IPC error code
 */
function describeLaunchFailure(
  error: unknown
): Pick<StartSessionResponse, 'message' | 'errorCode'> {
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
  };
}

/**
 * Owns the daemon's session and answers client requests.
 */
export class SessionController {
  private session: Session | null = null;
  private launching: { session: Session | null; done: Promise<unknown> } | null = null;
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
    if (!this.session) {
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
      return { ...base, status: 'error', error: NO_SESSION_ERROR };
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
            totals: { network: data.totalNetwork, console: data.totalConsole },
            currentNavigationId: data.currentNavigationId,
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
      return { ...base, status: 'error', error: NO_SESSION_ERROR };
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
   * @returns Command response, forwarding exit code and suggestion on failure
   */
  async command(request: ClientRequestUnion): Promise<unknown> {
    const name = request.type.slice(0, -'_request'.length) as CommandName;
    const base = { type: `${name}_response`, sessionId: request.sessionId };
    if (!this.session) {
      return { ...base, status: 'error', error: NO_SESSION_ERROR };
    }
    const { sessionId: _sessionId, type: _type, ...params } = request;
    try {
      const execute = this.session.execute.bind(this.session) as (
        n: CommandName,
        p: unknown
      ) => Promise<unknown>;
      const data = await withTimeout(execute(name, params), COMMAND_TIMEOUT_MS, 'Command');
      return { ...base, status: 'ok', data };
    } catch (error) {
      return { ...base, status: 'error', ...describeCommandError(error) };
    }
  }

  /**
   * Start a session, or report the one already running.
   *
   * A start whose client disconnects (Ctrl-C) is abandoned: the session is
   * stopped, whether it is still launching or has just started, since nobody
   * learns that it exists.
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

    const launching: { session: Session | null; done: Promise<unknown> } = {
      session: null,
      done: Promise.resolve(),
    };
    const run = this.launchSession(request, (session) => {
      launching.session = session;
    });
    launching.done = run;
    this.launching = launching;
    const stopAbandoned = (): void => {
      log.info('Client disconnected during start; stopping the session');
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
        message: 'No active session found',
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
      message: `Session already running (PID ${process.pid}). Stop it first with: bdg stop`,
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
