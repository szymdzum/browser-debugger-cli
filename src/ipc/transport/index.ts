/**
 * IPC Transport Layer
 *
 * Handles Unix domain socket communication with JSONL protocol.
 */

import { getIPCRequestTimeout } from '@/constants.js';
import { getDaemonSocketPath } from '@/session/paths.js';
import { createLogger } from '@/ui/logging/index.js';

import {
  formatConnectionError,
  formatEarlyCloseError,
  formatParseError,
  formatTimeoutError,
} from './errors.js';
import { JSONLBuffer, parseJSONLFrame, toJSONLFrame } from './jsonl.js';
import { createSocket } from './socket.js';
import { validateResponseType, validateSessionId } from './validation.js';

const log = createLogger('client');

type WithTypeAndSession = { type: string; sessionId: string };

/**
 * Send IPC request and wait for response.
 * Handles connection, JSONL protocol, validation, timeout, and cleanup.
 */
export async function sendRequest<
  TRequest extends WithTypeAndSession,
  TResponse extends WithTypeAndSession,
>(request: TRequest, requestName: string, expectedType?: string): Promise<TResponse> {
  const socketPath = getDaemonSocketPath();
  const timeoutMs = getIPCRequestTimeout();

  return new Promise((resolve, reject) => {
    const buffer = new JSONLBuffer();
    let resolved = false;

    const resolveOnce = (cleanup: () => void, error?: Error, response?: TResponse): void => {
      if (resolved) return;
      resolved = true;
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
          const lines = buffer.process(chunk);

          for (const line of lines) {
            if (resolved) return;

            try {
              const response = parseJSONLFrame<TResponse>(line);
              log.debug(`${requestName} response received`);

              validateSessionId(request, response, requestName);
              if (expectedType) {
                validateResponseType(response, expectedType, requestName);
              }

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
  });
}
