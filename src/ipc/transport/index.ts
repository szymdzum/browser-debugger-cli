/**
 * IPC Transport Layer
 *
 * Handles Unix domain socket communication with JSONL protocol.
 */

import * as path from 'path';

import { getIPCRequestTimeout } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { untrustedSessionDirError } from '@/errors/messages.js';
import type { IPCErrorFrame } from '@/ipc/session/index.js';
import { noteTabMove } from '@/ipc/utils/tabMove.js';
import { getDaemonSocketPath, secureSessionDir } from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import {
  formatCancelledError,
  formatConnectionError,
  formatEarlyCloseError,
  formatParseError,
  formatReplyOverflowError,
  formatTimeoutError,
} from './errors.js';
import { JSONLBuffer, JSONLBufferOverflowError, parseJSONLFrame, toJSONLFrame } from './jsonl.js';
import { createSocket } from './socket.js';
import { validateResponseType, validateSessionId } from './validation.js';

export {
  IPCError,
  IPCCancelledError,
  IPCConnectionError,
  IPCTimeoutError,
  IPCParseError,
  IPCEarlyCloseError,
} from './IPCError.js';

const log = createLogger('client');

type WithTypeAndSession = { type: string; sessionId: string };

/**
 * Whether a frame is the daemon's error reply to a frame it could not answer
 * with a response of its type.
 *
 * @param frame - Parsed response frame
 * @returns True for an `error_response` frame
 */
function isErrorFrame(frame: WithTypeAndSession): frame is IPCErrorFrame {
  return frame.type === 'error_response';
}

/**
 * The daemon's error reply as the error the command ends with.
 *
 * @param frame - Error frame
 * @returns Command error with the frame's suggestion and exit code
 */
function errorFrameToCommandError(frame: IPCErrorFrame): CommandError {
  return new CommandError(
    frame.error,
    frame.suggestion ? { suggestion: frame.suggestion } : {},
    frame.exitCode ?? EXIT_CODES.SOFTWARE_ERROR
  );
}

/**
 * Send IPC request and wait for response.
 * Handles connection, JSONL protocol, validation, timeout, and cleanup.
 *
 * @param request - Request to send
 * @param requestName - Name used in errors and logs
 * @param expectedType - Response type to validate, if any
 * @param timeoutMs - How long to wait for the response (default: IPC timeout)
 * @param socketPath - Daemon socket (default: the selected session's)
 * @param signal - Closes the connection and rejects when aborted (the daemon
 *   sees the client disconnect, e.g. an interrupted start is cancelled)
 * @returns The daemon's response
 * @throws CommandError (103) before connecting when the socket's session
 *   directory cannot be trusted (see {@link secureSessionDir}): a socket
 *   planted there by another user would receive the request. The check runs
 *   just before connecting, by path; replacing the socket in that window
 *   needs write access to a directory of the chain, which the check has
 *   just found only the user has
 */
export async function sendRequest<
  TRequest extends WithTypeAndSession,
  TResponse extends WithTypeAndSession,
>(
  request: TRequest,
  requestName: string,
  expectedType?: string,
  timeoutMs: number = getIPCRequestTimeout(),
  socketPath: string = getDaemonSocketPath(),
  signal?: AbortSignal
): Promise<TResponse> {
  const untrusted = secureSessionDir(path.dirname(socketPath));
  if (untrusted) {
    const err = untrustedSessionDirError(untrusted);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(formatCancelledError(requestName));
      return;
    }
    const buffer = new JSONLBuffer();
    let resolved = false;
    let onAbort = (): void => {};

    const resolveOnce = (cleanup: () => void, error?: Error, response?: TResponse): void => {
      if (resolved) return;
      resolved = true;
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      if (error) {
        reject(error);
      } else if (response) {
        resolve(response);
      }
    };

    const { cleanup } = createSocket(
      { socketPath, timeoutMs, requestName },
      {
        onConnect: (s) => {
          s.write(toJSONLFrame(request));
          log.debug(`${requestName} request sent`);
        },

        onData: (chunk: string) => {
          let lines: string[];
          try {
            lines = buffer.process(chunk);
          } catch (error) {
            resolveOnce(
              cleanup,
              error instanceof JSONLBufferOverflowError
                ? formatReplyOverflowError(error, request.type)
                : formatParseError(requestName, error)
            );
            return;
          }

          for (const line of lines) {
            if (resolved) return;

            try {
              const response = parseJSONLFrame<TResponse>(line);
              log.debug(`${requestName} response received`);

              if (isErrorFrame(response)) {
                resolveOnce(cleanup, errorFrameToCommandError(response));
                return;
              }

              validateSessionId(request, response, requestName);
              if (expectedType) {
                validateResponseType(response, expectedType, requestName);
              }

              noteTabMove(response);
              resolveOnce(cleanup, undefined, response);
            } catch (error) {
              resolveOnce(cleanup, formatParseError(requestName, error));
            }
          }
        },

        onError: (err) => {
          resolveOnce(cleanup, formatConnectionError(requestName, socketPath, err));
        },

        onClose: () => {
          resolveOnce(cleanup, formatEarlyCloseError(requestName));
        },

        onEnd: () => {
          resolveOnce(cleanup, formatEarlyCloseError(requestName));
        },

        onTimeout: () => {
          resolveOnce(cleanup, formatTimeoutError(requestName, timeoutMs));
        },
      }
    );
    onAbort = (): void => resolveOnce(cleanup, formatCancelledError(requestName));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
