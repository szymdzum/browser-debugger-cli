/**
 * Worker IPC Handler
 *
 * Handles IPC messages from daemon via stdin.
 * Processes command requests and sends responses via stdout.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { CommandRegistry } from '@/daemon/worker/commandRegistry.js';
import { CommandError } from '@/errors/index.js';
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
 * Error metadata preserved across the IPC boundary so the CLI can render
 * the same exit code and recovery hint a local `CommandError` would have
 * produced. Populated from `CommandError` when available.
 */
interface ForwardedErrorInfo {
  error: string;
  exitCode?: number;
  suggestion?: string;
}

/**
 * Extract forwardable error metadata from a thrown value.
 */
function extractErrorInfo(error: unknown): ForwardedErrorInfo {
  if (error instanceof CommandError) {
    const info: ForwardedErrorInfo = {
      error: error.message,
      exitCode: error.exitCode,
    };
    const suggestion = error.metadata['suggestion'];
    if (typeof suggestion === 'string') {
      info.suggestion = suggestion;
    }
    return info;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { error: message };
}

/**
 * Send a typed error response for a known requestId. Both the unknown-
 * command early-return path and the handler-threw path use this so the
 * client sees a consistent failure envelope.
 */
function sendErrorResponse(commandName: string, requestId: string, info: ForwardedErrorInfo): void {
  const response = {
    type: `${commandName}_response`,
    requestId,
    success: false,
    error: info.error,
    ...(info.exitCode !== undefined && { exitCode: info.exitCode }),
    ...(info.suggestion !== undefined && { suggestion: info.suggestion }),
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
    sendErrorResponse(commandName, message.requestId, {
      error: `Unknown command: ${commandName}`,
    });
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
    const info = extractErrorInfo(error);
    sendErrorResponse(commandName, message.requestId, info);
    log.debug(workerCommandResponse(commandName, false, info.error));
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
