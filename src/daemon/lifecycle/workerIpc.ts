/**
 * Worker IPC Handler
 *
 * Handles IPC messages from daemon via stdin.
 * Processes command requests and sends responses via stdout.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { CommandRegistry } from '@/daemon/worker/commandRegistry.js';
import type { CommandName, WorkerResponse } from '@/ipc/index.js';
import { COMMANDS } from '@/ipc/protocol/commands.js';
import type { Logger } from '@/ui/logging/index.js';
import {
  workerUnknownCommand,
  workerHandlingCommand,
  workerCommandResponse,
  workerIPCParseError,
  workerStdinClosed,
  workerStdinListenerSetup,
} from '@/ui/messages/debug.js';
import { getErrorMessage } from '@/utils/errors.js';

/**
 * Shape of a validated worker request: envelope fields plus command-specific
 * params (which the handler itself is responsible for introspecting).
 */
interface ValidatedWorkerRequest {
  type: `${CommandName}_request`;
  requestId: string;
  [key: string]: unknown;
}

/**
 * Validate a parsed JSON payload is a well-formed worker request.
 *
 * Enforces envelope invariants (type, requestId) and that `type` corresponds
 * to a known command. Without this, unknown/garbage commands used to silently
 * fall through and the daemon-side client would time out waiting for a
 * response it will never receive.
 */
function isValidWorkerRequest(obj: unknown): obj is ValidatedWorkerRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  if (typeof candidate['type'] !== 'string') return false;
  if (typeof candidate['requestId'] !== 'string') return false;

  const type = candidate['type'];
  if (!type.endsWith('_request')) return false;

  const commandName = type.slice(0, -'_request'.length);
  return Object.prototype.hasOwnProperty.call(COMMANDS, commandName);
}

/**
 * Send a typed error response for a known requestId.
 *
 * Carved out so both the "unknown command" early-return path and the
 * handler-threw path emit responses in the same format — previously the
 * unknown-command path just logged and dropped the request, causing the
 * client to time out rather than see a typed error.
 */
function sendErrorResponse(commandName: string, requestId: string, error: string): void {
  const response = {
    type: `${commandName}_response`,
    requestId,
    success: false,
    error,
  };
  console.log(JSON.stringify(response));
}

/**
 * Handle incoming IPC message from daemon.
 */
async function handleWorkerIPC(
  message: ValidatedWorkerRequest,
  cdp: CDPConnection,
  commandRegistry: CommandRegistry,
  log: Logger
): Promise<void> {
  const commandName = message.type.slice(0, -'_request'.length) as CommandName;
  const handler = commandRegistry[commandName];

  if (!handler) {
    log.debug(workerUnknownCommand(commandName));
    sendErrorResponse(commandName, message.requestId, `Unknown command: ${commandName}`);
    return;
  }

  log.debug(workerHandlingCommand(commandName));

  try {
    const { type: _type, requestId: _requestId, ...params } = message;

    const data = await (handler as (cdp: CDPConnection, params: unknown) => Promise<unknown>)(
      cdp,
      params
    );

    type ResponseData = Extract<WorkerResponse<typeof commandName>, { success: true }>['data'];
    const response: WorkerResponse<typeof commandName> = {
      type: `${commandName}_response` as const,
      requestId: message.requestId,
      success: true,
      data: data as ResponseData,
    };

    console.log(JSON.stringify(response));
    log.debug(workerCommandResponse(commandName, true));
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    sendErrorResponse(commandName, message.requestId, errorMessage);
    log.debug(workerCommandResponse(commandName, false, errorMessage));
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
  });

  log.debug(workerStdinListenerSetup());
}
