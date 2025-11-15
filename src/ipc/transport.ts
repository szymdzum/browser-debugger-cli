import { connect } from 'net';

import type { Socket } from 'net';

import { getIPCRequestTimeout } from '@/constants.js';
import { getDaemonSocketPath } from '@/session/paths.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('client');

type WithTypeAndSession = { type: string; sessionId: string };

export async function sendRequest<
  TRequest extends WithTypeAndSession,
  TResponse extends WithTypeAndSession,
>(request: TRequest, requestName: string, expectedType?: string): Promise<TResponse> {
  const socketPath = getDaemonSocketPath();

  return new Promise((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    let buffer = '';
    let resolved = false;

    const timeoutMs = getIPCRequestTimeout();
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`${requestName} request timeout after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    socket.once('connect', () => {
      log.debug(`Connected to daemon for ${requestName} request`);
      socket.write(JSON.stringify(request) + '\n');
      log.debug(`${requestName} request sent`);
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.trim() && !resolved) {
          try {
            const response = JSON.parse(line) as TResponse;
            log.debug(`${requestName} response received`);

            if (response.sessionId !== request.sessionId) {
              throw new Error(`${requestName} response sessionId mismatch`);
            }
            if (expectedType && response.type !== expectedType) {
              throw new Error(
                `${requestName} unexpected response type: ${response.type} (expected ${expectedType})`
              );
            }

            resolved = true;
            clearTimeout(timeout);
            socket.destroy();
            resolve(response);
          } catch (error) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              reject(
                new Error(`Failed to parse ${requestName} response: ${getErrorMessage(error)}`)
              );
            }
          }
        }
      }
    });

    socket.once('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        const code = (err as NodeJS.ErrnoException).code;
        const fullMessage = [
          `IPC ${requestName} connection error`,
          `Socket: ${socketPath}`,
          ...(code ? [`Code: ${code}`] : []),
          `Details: ${err.message}`,
        ].join(' | ');
        reject(new Error(fullMessage));
      }
    });

    const handleEarlyClose = (): void => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Connection closed before ${requestName} response received`));
      }
    };

    socket.once('end', handleEarlyClose);
    socket.once('close', handleEarlyClose);
  });
}
