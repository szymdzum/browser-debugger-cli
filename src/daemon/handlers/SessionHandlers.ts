/**
 * Session Handlers
 *
 * Handles session lifecycle requests: start and stop.
 */

import type { Socket } from 'net';

import type { WorkerManager } from '@/daemon/server/WorkerManager.js';
import type { ISessionService } from '@/daemon/services/SessionService.js';
import { WorkerStartError } from '@/daemon/startSession.js';
import {
  type StartSessionRequest,
  type StartSessionResponse,
  type StartSessionResponseData,
  type StopSessionRequest,
  type StopSessionResponse,
  IPCErrorCode,
} from '@/ipc/index.js';
import type { CDPTarget } from '@/types.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { fetchCDPTargets } from '@/utils/http.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('daemon');

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
   */
  async handleStartSession(socket: Socket, request: StartSessionRequest): Promise<void> {
    console.error(
      `[daemon] Start session request received (sessionId: ${request.sessionId}, url: ${request.url})`
    );

    try {
      // Check for existing session (concurrency guard)
      const sessionPid = this.sessionService.readPid();
      if (sessionPid && this.sessionService.isProcessAlive(sessionPid)) {
        // Read session metadata to provide helpful error context
        const metadata = this.sessionService.readMetadata({ warnOnCorruption: false });
        const startTime = metadata?.startTime;
        const duration = startTime ? Math.floor((Date.now() - startTime) / 1000) : undefined;

        // Try to get target URL from CDP
        let targetUrl: string | undefined;
        if (metadata?.port && metadata?.targetId) {
          try {
            const targets = await fetchCDPTargets(metadata.port);
            const target = targets.find((t: CDPTarget) => t.id === metadata.targetId);
            if (target) {
              targetUrl = target.url;
            }
          } catch (error) {
            log.debug(
              `Failed to fetch CDP targets for existing session: ${getErrorMessage(error)}`
            );
          }
        }

        const response: StartSessionResponse = {
          type: 'start_session_response',
          sessionId: request.sessionId,
          status: 'error',
          message: `Session already running (PID ${sessionPid}). Stop it first with stop_session_request.`,
          errorCode: IPCErrorCode.SESSION_ALREADY_RUNNING,
          existingSession: {
            pid: sessionPid,
            ...(targetUrl && { targetUrl }),
            ...(startTime && { startTime }),
            ...(duration !== undefined && { duration }),
          },
        };

        this.sendResponse(socket, response);
        console.error('[daemon] Start session error response sent (session already running)');
        return;
      }

      // Launch worker
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
          })
        );

        console.error('[daemon] Worker launched successfully');

        // Build response data
        const data: StartSessionResponseData = {
          workerPid: metadata.workerPid,
          chromePid: metadata.chromePid,
          port: metadata.port,
          targetUrl: metadata.targetUrl,
          ...(metadata.targetTitle !== undefined && { targetTitle: metadata.targetTitle }),
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
        // Map worker errors to IPC error codes
        let errorCode: IPCErrorCode = IPCErrorCode.WORKER_START_FAILED;
        let errorMessage = 'Failed to start worker';

        if (error instanceof WorkerStartError) {
          // Include error details (contains worker stderr) for debugging
          errorMessage = error.details ? `${error.message}\n${error.details}` : error.message;
          switch (error.code) {
            case 'SPAWN_FAILED':
            case 'WORKER_CRASH':
            case 'INVALID_READY_MESSAGE':
              errorCode = IPCErrorCode.WORKER_START_FAILED;
              break;
            case 'READY_TIMEOUT':
              errorCode = IPCErrorCode.CDP_TIMEOUT;
              break;
          }
        } else {
          errorMessage = getErrorMessage(error);
        }

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
    } catch (error) {
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
  }

  /**
   * Handle stop session request.
   */
  handleStopSession(socket: Socket, request: StopSessionRequest): void {
    console.error(`[daemon] Stop session request received (sessionId: ${request.sessionId})`);

    try {
      // Check for active session
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

      // Capture Chrome PID BEFORE cleanup (so CLI can kill Chrome if needed)
      const metadata = this.sessionService.readMetadata({ warnOnCorruption: true });
      const chromePid = metadata?.chromePid;
      if (chromePid) {
        console.error(`[daemon] Captured Chrome PID ${chromePid} before cleanup`);
      }

      // Kill the session process (use SIGTERM for graceful shutdown)
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

      // Clean up session files
      this.sessionService.cleanup();
      console.error('[daemon] Cleaned up session files');

      // Clear worker process reference
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

      // Release lock immediately so new sessions can start
      this.sessionService.releaseLock();
      console.error('[daemon] Daemon lock released');

      // Shutdown daemon after successful stop
      // Give socket time to flush response, then exit gracefully
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
}
