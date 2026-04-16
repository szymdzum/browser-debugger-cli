/**
 * Session Handlers
 *
 * Handles session lifecycle requests: start and stop.
 */

import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { ISessionService } from '@/daemon/services/SessionService.js';
import { WorkerStartError } from '@/daemon/startSession.js';
import { sessionTargetMismatchError } from '@/errors/messages.js';
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
 * Sentinel returned by `reconcileExistingSession` when it has already
 * produced a response (idempotent "already running" or mismatch error).
 * Using a unique symbol avoids overloading the string/undefined return
 * channel that carries the recovered previous target.
 */
const HANDLED_SENTINEL = Symbol('start_session_handled');

/**
 * Map a thrown worker-launch error to the IPC error shape.
 *
 * Kept as a pure function so the orchestrator stays focused on flow control
 * rather than error classification.
 */
function mapLaunchError(error: unknown): { errorCode: IPCErrorCode; errorMessage: string } {
  if (error instanceof WorkerStartError) {
    const errorMessage = error.details ? `${error.message}\n${error.details}` : error.message;
    switch (error.code) {
      case 'READY_TIMEOUT':
        return { errorCode: IPCErrorCode.CDP_TIMEOUT, errorMessage };
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
 * Handles session start and stop requests.
 */
export class SessionHandlers {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly sessionService: ISessionService,
    private readonly sendResponse: SendResponseFn
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
    console.error(
      `[daemon] Start session request received (sessionId: ${request.sessionId}, url: ${request.url})`
    );

    try {
      const recoveredPreviousTarget = await this.reconcileExistingSession(socket, request);
      if (recoveredPreviousTarget === HANDLED_SENTINEL) {
        return;
      }
      await this.launchAndRespond(socket, request, recoveredPreviousTarget);
    } catch (error) {
      this.sendDaemonErrorResponse(socket, request, error);
    }
  }

  /**
   * Check for an existing session and either respond inline (idempotent or
   * mismatch), silently recover a stale one, or signal that the caller should
   * proceed to launch a new worker.
   *
   * @returns `HANDLED_SENTINEL` when a response has already been sent,
   *          otherwise the previous ws URL if a stale session was recovered,
   *          or `undefined` when no prior session existed.
   */
  private async reconcileExistingSession(
    socket: Socket,
    request: StartSessionRequest
  ): Promise<string | undefined | typeof HANDLED_SENTINEL> {
    const sessionPid = this.sessionService.readPid();
    if (!sessionPid || !this.sessionService.isProcessAlive(sessionPid)) {
      return undefined;
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
      return HANDLED_SENTINEL;
    }

    // log.info (not console.error) — this notice is user-facing: callers should
    // see that a stale session was silently recovered. Internal daemon progress
    // continues through console.error('[daemon] ...') above/below.
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
    return metadata?.webSocketDebuggerUrl ?? probe.targetUrl;
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
    console.error('[daemon] Launching worker...');
    try {
      const metadata = await this.workerManager.launch(
        request.url,
        filterDefined({
          port: request.port,
          timeout: request.timeout,
          telemetry: request.telemetry,
          includeAll: request.includeAll,
          userDataDir: request.userDataDir,
          maxBodySize: request.maxBodySize,
          headless: request.headless,
          chromeWsUrl: request.chromeWsUrl,
          chromeFlags: request.chromeFlags,
        })
      );

      console.error('[daemon] Worker launched successfully');

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
      console.error('[daemon] Start session response sent');
    } catch (error) {
      const { errorCode, errorMessage } = mapLaunchError(error);
      const response: StartSessionResponse = {
        type: 'start_session_response',
        sessionId: request.sessionId,
        status: 'error',
        message: errorMessage,
        errorCode,
      };

      this.sendResponse(socket, response);
      console.error(`[daemon] Start session error response sent (${errorCode})`);
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
    console.error('[daemon] Start session error response sent (daemon error)');
  }

  /**
   * Handle stop session request.
   */
  handleStopSession(socket: Socket, request: StopSessionRequest): void {
    console.error(`[daemon] Stop session request received (sessionId: ${request.sessionId})`);

    try {
      const sessionPid = this.sessionService.readPid();
      if (!sessionPid || !this.sessionService.isProcessAlive(sessionPid)) {
        const response: StopSessionResponse = {
          type: 'stop_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: 'No active session found',
          errorCode: IPCErrorCode.NO_SESSION,
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Stop session error response sent (no session)');
        return;
      }

      const metadata = this.sessionService.readMetadata({ warnOnCorruption: true });
      const chromePid = metadata?.chromePid;
      if (chromePid) {
        console.error(`[daemon] Captured Chrome PID ${chromePid} before cleanup`);
      }

      try {
        process.kill(sessionPid, 'SIGTERM');
        console.error(`[daemon] Sent SIGTERM to session process (PID ${sessionPid})`);
      } catch (killError: unknown) {
        const errorMessage = killError instanceof Error ? killError.message : String(killError);
        const response: StopSessionResponse = {
          type: 'stop_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: `Failed to kill session process: ${errorMessage}`,
          errorCode: IPCErrorCode.SESSION_KILL_FAILED,
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Stop session error response sent (kill failed)');
        return;
      }

      this.sessionService.cleanup();
      console.error('[daemon] Cleaned up session files');

      this.workerManager.dispose();
      console.error('[daemon] Cleared worker process reference');

      const response: StopSessionResponse = {
        type: 'stop_session_response',
        sessionId: request.sessionId,
        status: 'ok',
        message: 'Session stopped successfully',
        ...(chromePid !== undefined && { chromePid }),
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Stop session response sent');

      this.sessionService.releaseLock();
      console.error('[daemon] Daemon lock released');

      setTimeout(() => {
        console.error('[daemon] Shutting down daemon after successful stop');
        process.exit(0);
      }, 100);
    } catch (error) {
      const response: StopSessionResponse = {
        type: 'stop_session_response',
        sessionId: request.sessionId,
        status: 'error',
        message: `Failed to stop session: ${getErrorMessage(error)}`,
        errorCode: IPCErrorCode.DAEMON_ERROR,
      };

      this.sendResponse(socket, response);
      console.error('[daemon] Stop session error response sent');
    }
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
    const startTime = metadata?.startTime;
    const duration = startTime ? Math.floor((Date.now() - startTime) / 1000) : undefined;

    return {
      pid: sessionPid,
      ...(targetUrl && { targetUrl }),
      ...(startTime && { startTime }),
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
    console.error('[daemon] Start session error response sent (session already running)');
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
    const response: StartSessionResponse = {
      type: 'start_session_response',
      sessionId: request.sessionId,
      status: 'error',
      message: sessionTargetMismatchError(mismatch.current, mismatch.requested),
      errorCode: IPCErrorCode.SESSION_TARGET_MISMATCH,
      existingSession: this.buildExistingSession(sessionPid, metadata, mismatch.current),
    };

    this.sendResponse(socket, response);
    console.error('[daemon] Start session error response sent (target mismatch)');
  }
}
