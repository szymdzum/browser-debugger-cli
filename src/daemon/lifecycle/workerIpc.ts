/**
 * Worker IPC Handler
 *
 * Handles IPC messages from daemon via stdin.
 * Processes command requests and sends responses via stdout.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { getErrorMessage } from '@/connection/errors.js';
import type { CommandRegistry } from '@/daemon/worker/commandRegistry.js';
import type { CommandName, WorkerRequestUnion, WorkerResponse } from '@/ipc/index.js';
import type { Logger } from '@/ui/logging/index.js';
import {
  workerUnknownCommand,
  workerHandlingCommand,
  workerCommandResponse,
  workerIPCParseError,
  workerStdinClosed,
  workerStdinListenerSetup,
} from '@/ui/messages/debug.js';

/**
 * Type guard to validate parsed JSON is a valid WorkerRequest.
 */
function isValidWorkerRequest(obj: unknown): obj is WorkerRequestUnion {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  return 'type' in obj && typeof obj.type === 'string' && 'requestId' in obj;
}

/**
 * Handle incoming IPC message from daemon.
 */
async function handleWorkerIPC(
  message: WorkerRequestUnion,
  cdp: CDPConnection,
  commandRegistry: CommandRegistry,
  log: Logger
): Promise<void> {
  const commandName = message.type.replace('_request', '') as CommandName;
  const handler = commandRegistry[commandName];

  if (!handler) {
    log.debug(workerUnknownCommand(commandName));
    return;
  }

  log.debug(workerHandlingCommand(commandName));

  try {
    const { type: _type, requestId: _requestId, ...params } = message;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const data = await handler(cdp, params as any);

    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: true,
      data,
    };

    console.log(JSON.stringify(response));
    log.debug(workerCommandResponse(commandName, true));
  } catch (error) {
    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: false,
      error: getErrorMessage(error),
    };

    console.log(JSON.stringify(response));
    log.debug(workerCommandResponse(commandName, false, response.error));
  }
}

/**
 * Set up stdin listener for IPC commands from daemon.
 */
export function setupStdinListener(
  cdp: CDPConnection,
  commandRegistry: CommandRegistry,
  log: Logger
): void {
  let buffer = '';

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isValidWorkerRequest(parsed)) {
            log.debug(`Invalid worker request structure: ${line}`);
            continue;
          }
          void handleWorkerIPC(parsed, cdp, commandRegistry, log);
        } catch (error) {
          log.debug(workerIPCParseError(getErrorMessage(error)));
        }
      }
    }
  });

  process.stdin.on('end', () => {
    log.debug(workerStdinClosed());
  });

  process.stdin.on('error', (error) => {
    log.debug(`[worker] stdin error: ${getErrorMessage(error)}`);
    // Continue operation - worker can still function via CDP
  });

  log.debug(workerStdinListenerSetup());
}
