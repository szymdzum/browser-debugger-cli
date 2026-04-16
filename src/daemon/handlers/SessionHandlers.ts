/**
 * Session Handlers
 *
 * Handles session lifecycle requests: start and stop.
 */

import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { ISessionService } from '@/daemon/services/SessionService.js';
import { WorkerStartError } from '@/daemon/startSession.js';
import { LAUNCHED_CHROME_DESCRIPTION, sessionTargetMismatchError } from '@/errors/messages.js';
import {
  type StartSessionRequest,
  type StartSessionResponse,
  type StartSessionResponseData,
  type StopSessionRequest,
  type StopSessionResponse,
  IPCErrorCode,
} from '@/ipc/index.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { filterDefined } from '@/utils/objects.js';

import { detectTargetMismatch, probeSessionAlive, type TargetMismatch } from './sessionProbe.js';

const log = createLogger('daemon');

/**
 * Outcome of reconciling a start-session request against existing state.
 *
 * - `handled`: a response was already sent (idempotent or mismatch); caller stops.
 * - `fresh`: no prior session existed; caller should launch cleanly.
 * - `recovered`: a stale session was force-killed; caller launches and echoes
 *   the previous target so clients can tell recovery happened.
 */
type ReconcileOutcome =
  | { kind: 'handled' }
  | { kind: 'fresh' }
  | { kind: 'recovered'; previousTarget: string };

/**
 * Map a thrown worker-launch error to the IPC error shape.
 *
 * Kept as a pure function so the orchestrator stays focused on flow control
 * rather than error classification.
 */
function mapLaunchError(
  error: unknown,
  chromeWsUrl?: string
): { errorCode: IPCErrorCode; errorMessage: string } {
  if (error instanceof WorkerStartError) {
    // Worker stderr is already forwarded to the daemon log; don't splice it
    // into the user-facing error. Agents see a clean one-line message and
    // can read ~/.bdg/daemon.log for the raw worker output.
    const errorMessage =
      error.code === 'WORKER_CRASH' && chromeWsUrl
        ? `Could not attach to Chrome at ${chromeWsUrl} (connection refused or invalid WebSocket URL). Check the URL and ensure Chrome is reachable.`
        : error.message;
    switch (error.code) {
      case 'READY_TIMEOUT':
        return { errorCode: IPCErrorCode.CDP_TIMEOUT, errorMessage };
      case 'NAVIGATION_FAILED':
        return { errorCode: IPCErrorCode.NAVIGATION_FAILED, errorMessage };
      case 'SPAWN_FAILED':
      case 'WORKER_CRASH':
      case 'INVALID_READY_MESSAGE':
        return { errorCode: IPCErrorCode.WORKER_START_FAILED, errorMessage };
    }
  }
  return {
    errorCode: IPCErrorCode.WORKER_START_FAILED,
    errorMessage: getErrorMessage(error),
  };
}

/**
 * Response sender function type.
 */
type SendResponseFn = (socket: Socket, response: unknown) => void;

/**
 * Callback invoked after a successful stop, signalling that the daemon
 * process should shut down. The handler does not own the shutdown itself so
 * that `process.exit` stays out of the request-handling path and tests can
 * observe the shutdown intent without mocking `process`.
 */
type RequestShutdownFn = () => void;

/**
 * Result of a worker-termination attempt.
 */
type TerminateResult = { ok: true } | { ok: false; reason: string };

/**
 * Handles session start and stop requests.
 */
export class SessionHandlers {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly sessionService: ISessionService,
    private readonly sendResponse: SendResponseFn,
    private readonly requestShutdown: RequestShutdownFn
  ) {}

  /**
   * Handle start session request.
   *
   * High-level flow:
   * 1. If a session is recorded and its worker process is alive, probe its
   *    Chrome over CDP HTTP.
   *    - Probe alive + same intent  → "already running" (idempotent).
   *    - Probe alive + different intent → SESSION_TARGET_MISMATCH.
   *    - Probe fails (stale) → silent recovery, fall through to launch.
   * 2. Launch a fresh worker.
   */
  async handleStartSession(socket: Socket, request: StartSessionRequest): Promise<void> {
    log.info(
      `Start session request received (sessionId: ${request.sessionId}, url: ${request.url})`
    );

    try {
      const outcome = await this.reconcileExistingSession(socket, request);
      if (outcome.kind === 'handled') {
        return;
      }
      const recoveredPreviousTarget =
        outcome.kind === 'recovered' ? outcome.previousTarget : undefined;
      await this.launchAndRespond(socket, request, recoveredPreviousTarget);
    } catch (error) {
      this.sendDaemonErrorResponse(socket, request, error);
    }
  }

  /**
   * Check for an existing session and either respond inline (idempotent or
   * mismatch), silently recover a stale one, or signal that the caller should
   * proceed to launch a new worker.
   */
  private async reconcileExistingSession(
    socket: Socket,
    request: StartSessionRequest
  ): Promise<ReconcileOutcome> {
    const sessionPid = this.sessionService.readPid();
    if (!sessionPid || !this.sessionService.isProcessAlive(sessionPid)) {
      return { kind: 'fresh' };
    }

    const metadata = this.sessionService.readMetadata({ warnOnCorruption: false });
    const probe = await probeSessionAlive(metadata, log);

    if (probe.alive) {
      const mismatch = detectTargetMismatch(request, metadata);
      if (mismatch) {
        this.sendMismatchResponse(socket, request, sessionPid, metadata, mismatch);
      } else {
        this.sendAlreadyRunningResponse(socket, request, sessionPid, metadata, probe.targetUrl);
      }
      return { kind: 'handled' };
    }

    log.info(
      `Stale session detected (PID ${sessionPid}, target ${
        metadata?.webSocketDebuggerUrl ?? `port ${metadata?.port ?? 'unknown'}`
      } unresponsive). Recovering and starting fresh.`
    );
    await this.sessionService.forceRecoverStaleSession(sessionPid, metadata?.chromePid);
    // Synchronously clear the in-process worker reference so the imminent
    // `workerManager.launch()` doesn't race the child 'exit' event and throw
    // WORKER_ALREADY_RUNNING. dispose() is idempotent.
    this.workerManager.dispose();
    const previousTarget = metadata?.webSocketDebuggerUrl ?? probe.targetUrl;
    return previousTarget !== undefined ? { kind: 'recovered', previousTarget } : { kind: 'fresh' };
  }

  /**
   * Launch a fresh worker and send the success response, translating any
   * launch error into the appropriate IPC error response.
   */
  private async launchAndRespond(
    socket: Socket,
    request: StartSessionRequest,
    recoveredPreviousTarget: string | undefined
  ): Promise<void> {
    log.info('Launching worker...');
    try {
      // StartSessionRequest extends SessionOptions; stripping the IPC envelope
      // (type, sessionId, url) leaves the worker-launch option shape.
      const { type: _type, sessionId: _sessionId, url, ...options } = request;
      const metadata = await this.workerManager.launch(url, filterDefined(options));

      log.info('Worker launched successfully');

      const data: StartSessionResponseData = {
        workerPid: metadata.workerPid,
        chromePid: metadata.chromePid,
        port: metadata.port,
        targetUrl: metadata.targetUrl,
        ...(metadata.targetTitle !== undefined && { targetTitle: metadata.targetTitle }),
        ...(recoveredPreviousTarget !== undefined && {
          recovered: true,
          previousTarget: recoveredPreviousTarget,
        }),
      };

      const response: StartSessionResponse = {
        type: 'start_session_response',
        sessionId: request.sessionId,
        status: 'ok',
        data,
        message: 'Session started successfully',
      };

      this.sendResponse(socket, response);
      log.info('Start session response sent');
    } catch (error) {
      const { errorCode, errorMessage } = mapLaunchError(error, request.chromeWsUrl);
      const response: StartSessionResponse = {
        type: 'start_session_response',
        sessionId: request.sessionId,
        status: 'error',
        message: errorMessage,
        errorCode,
      };

      this.sendResponse(socket, response);
      log.info(`Start session error response sent (${errorCode})`);
    }
  }

  /**
   * Emit a generic daemon-error response for unexpected failures in the
   * start-session pipeline (outside the known launch-error surface).
   */
  private sendDaemonErrorResponse(
    socket: Socket,
    request: StartSessionRequest,
    error: unknown
  ): void {
    const response: StartSessionResponse = {
      type: 'start_session_response',
      sessionId: request.sessionId,
      status: 'error',
      message: `Daemon error: ${getErrorMessage(error)}`,
      errorCode: IPCErrorCode.DAEMON_ERROR,
    };

    this.sendResponse(socket, response);
    log.info('Start session error response sent (daemon error)');
  }

  /**
   * Handle stop session request.
   *
   * Flow:
   * 1. Locate the active session (respond `NO_SESSION` if absent).
   * 2. Terminate the worker (respond `SESSION_KILL_FAILED` if the signal fails).
   * 3. Finalize cleanup (session files, worker reference, daemon lock).
   * 4. Send success, then request daemon shutdown via the injected callback.
   */
  handleStopSession(socket: Socket, request: StopSessionRequest): void {
    log.info(`Stop session request received (sessionId: ${request.sessionId})`);

    try {
      const active = this.findActiveSession();
      if (!active) {
        this.sendStopErrorResponse(
          socket,
          request,
          'No active session found',
          IPCErrorCode.NO_SESSION,
          'no session'
        );
        return;
      }

      if (active.chromePid) {
        log.info(`Captured Chrome PID ${active.chromePid} before cleanup`);
      }

      const kill = this.terminateWorker(active.pid);
      if (!kill.ok) {
        this.sendStopErrorResponse(
          socket,
          request,
          `Failed to kill session process: ${kill.reason}`,
          IPCErrorCode.SESSION_KILL_FAILED,
          'kill failed'
        );
        return;
      }

      this.finalizeStopCleanup();
      this.sendStopSuccessResponse(socket, request, active.chromePid);
      this.requestShutdown();
    } catch (error) {
      this.sendStopErrorResponse(
        socket,
        request,
        `Failed to stop session: ${getErrorMessage(error)}`,
        IPCErrorCode.DAEMON_ERROR
      );
    }
  }

  /**
   * Return the active session's worker PID (and Chrome PID if bdg launched it),
   * or null when no live session is recorded.
   */
  private findActiveSession(): { pid: number; chromePid?: number } | null {
    const pid = this.sessionService.readPid();
    if (!pid || !this.sessionService.isProcessAlive(pid)) {
      return null;
    }
    const metadata = this.sessionService.readMetadata({ warnOnCorruption: true });
    return metadata?.chromePid !== undefined ? { pid, chromePid: metadata.chromePid } : { pid };
  }

  /**
   * SIGTERM the worker and report success/failure. Does not wait for the
   * worker to actually exit — the OS signal delivery is synchronous enough
   * for a human-facing response.
   */
  private terminateWorker(pid: number): TerminateResult {
    try {
      process.kill(pid, 'SIGTERM');
      log.info(`Sent SIGTERM to session process (PID ${pid})`);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: getErrorMessage(error) };
    }
  }

  /**
   * Remove session-scoped files, drop the worker reference, and release the
   * daemon lock. Kept as a single named step so the stop flow reads as
   * `terminate → finalize → respond → shutdown`.
   */
  private finalizeStopCleanup(): void {
    this.sessionService.cleanup();
    log.info('Cleaned up session files');

    this.workerManager.dispose();
    log.info('Cleared worker process reference');

    this.sessionService.releaseLock();
    log.info('Daemon lock released');
  }

  private sendStopSuccessResponse(
    socket: Socket,
    request: StopSessionRequest,
    chromePid: number | undefined
  ): void {
    const response: StopSessionResponse = {
      type: 'stop_session_response',
      sessionId: request.sessionId,
      status: 'ok',
      message: 'Session stopped successfully',
      ...(chromePid !== undefined && { chromePid }),
    };

    this.sendResponse(socket, response);
    log.info('Stop session response sent');
  }

  private sendStopErrorResponse(
    socket: Socket,
    request: StopSessionRequest,
    message: string,
    errorCode: IPCErrorCode,
    logContext?: string
  ): void {
    const response: StopSessionResponse = {
      type: 'stop_session_response',
      sessionId: request.sessionId,
      status: 'error',
      message,
      errorCode,
    };

    this.sendResponse(socket, response);
    log.info(`Stop session error response sent${logContext ? ` (${logContext})` : ''}`);
  }

  /**
   * Build the `existingSession` block shared by the idempotent and mismatch
   * error responses.
   */
  private buildExistingSession(
    sessionPid: number,
    metadata: SessionMetadata | null,
    targetUrl: string | undefined
  ): NonNullable<StartSessionResponse['existingSession']> {
    const startTime = typeof metadata?.startTime === 'number' ? metadata.startTime : undefined;
    const duration =
      startTime !== undefined ? Math.floor((Date.now() - startTime) / 1000) : undefined;

    return {
      pid: sessionPid,
      ...(targetUrl && { targetUrl }),
      ...(startTime !== undefined && { startTime }),
      ...(duration !== undefined && { duration }),
    };
  }

  /**
   * Send the idempotent "session already running" response when the probe
   * confirms a live session matching the caller's intent.
   */
  private sendAlreadyRunningResponse(
    socket: Socket,
    request: StartSessionRequest,
    sessionPid: number,
    metadata: SessionMetadata | null,
    targetUrl: string | undefined
  ): void {
    const response: StartSessionResponse = {
      type: 'start_session_response',
      sessionId: request.sessionId,
      status: 'error',
      message: `Session already running (PID ${sessionPid}). Stop it first with stop_session_request.`,
      errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
      existingSession: this.buildExistingSession(sessionPid, metadata, targetUrl),
    };

    this.sendResponse(socket, response);
    log.info('Start session error response sent (session already running)');
  }

  /**
   * Send the target-mismatch response when a live session exists but the
   * caller asked for a different Chrome target (attach vs launched, or a
   * different ws URL).
   */
  private sendMismatchResponse(
    socket: Socket,
    request: StartSessionRequest,
    sessionPid: number,
    metadata: SessionMetadata | null,
    mismatch: TargetMismatch
  ): void {
    // mismatch.current may be the LAUNCHED_CHROME_DESCRIPTION placeholder when
    // the active session is launched-mode. That string is a human label, not a
    // URL, so don't leak it into existingSession.targetUrl (which agents parse
    // programmatically) — the full-text message still renders it.
    const existingTargetUrl =
      mismatch.current === LAUNCHED_CHROME_DESCRIPTION ? undefined : mismatch.current;
    const response: StartSessionResponse = {
      type: 'start_session_response',
      sessionId: request.sessionId,
      status: 'error',
      message: sessionTargetMismatchError(mismatch.current, mismatch.requested),
      errorCode: IPCErrorCode.SESSION_TARGET_MISMATCH,
      existingSession: this.buildExistingSession(sessionPid, metadata, existingTargetUrl),
    };

    this.sendResponse(socket, response);
    log.info('Start session error response sent (target mismatch)');
  }
}
