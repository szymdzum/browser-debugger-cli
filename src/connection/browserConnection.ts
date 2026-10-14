/**
 * The one connection `bdg attach` opens to a running Chrome's browser
 * endpoint (#473). With remote debugging enabled at
 * chrome://inspect/#remote-debugging, every connection makes Chrome ask the
 * user to allow it, so it is opened once, never retried, and waits for the
 * answer.
 */

import { CDPConnection } from '@/connection/cdp.js';
import { CDPTimeoutError } from '@/connection/errors.js';
import { CommandError } from '@/errors/index.js';
import {
  remoteDebuggingDeclinedError,
  remoteDebuggingUnansweredError,
  staleDevToolsActivePortError,
} from '@/errors/messages.js';
import type { Logger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * How long the connection waits for the user to answer Chrome's prompt
 * (owner decision on #473): long enough to notice and click the prompt, and
 * well inside the 45 s a start waits for the daemon's answer, so a prompt
 * nobody answers ends as 102 rather than an IPC timeout.
 */
export const ATTACH_APPROVAL_TIMEOUT_MS = 30_000;

/** Options of {@link connectToBrowser} */
export interface BrowserConnectOptions {
  log?: Logger;
  signal?: AbortSignal | undefined;
  onDisconnect?: (cdp: CDPConnection) => void;
  /** The `DevToolsActivePort` file the URL came from (nothing listening: a stale file) */
  activePortFile?: string | undefined;
  /** How long to wait for the connection (the user's answer) */
  timeoutMs?: number;
}

/** ws's error for a refused upgrade: Chrome answers `403 Connection rejected` when the prompt is declined */
const DECLINED_RESPONSE = /Unexpected server response: 403/;

/** ws's error when the upgrade got no answer in time */
const HANDSHAKE_TIMED_OUT = /handshake has timed out/i;

/**
 * Open the browser connection: one WebSocket, never retried (each attempt
 * would show the prompt again), waiting up to `timeoutMs` for the user.
 *
 * @param wsUrl - Browser WebSocket URL
 * @param options - Options
 * @returns The connection
 * @throws CommandError 82 when the prompt was declined, 102 when it was not
 *   answered in time, 83 when nothing listens at a URL a `DevToolsActivePort`
 *   file named; other failures (an abort included) as they are
 */
export async function connectToBrowser(
  wsUrl: string,
  options: BrowserConnectOptions = {}
): Promise<CDPConnection> {
  const timeoutMs = options.timeoutMs ?? ATTACH_APPROVAL_TIMEOUT_MS;
  const { onDisconnect } = options;
  const cdp = new CDPConnection(options.log);
  try {
    await cdp.connect(wsUrl, {
      maxRetries: 1,
      timeout: timeoutMs,
      handshakeTimeout: timeoutMs,
      signal: options.signal,
      onDisconnect: onDisconnect && (() => onDisconnect(cdp)),
    });
    return cdp;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw describeFailure(error, wsUrl, timeoutMs, options.activePortFile) ?? error;
  }
}

/**
 * The CommandError a failed browser connection means, if it means one.
 *
 * @param error - The connection error
 * @param wsUrl - Browser WebSocket URL
 * @param timeoutMs - How long it waited
 * @param activePortFile - The `DevToolsActivePort` file the URL came from
 * @returns The error, or undefined to keep the original
 */
function describeFailure(
  error: unknown,
  wsUrl: string,
  timeoutMs: number,
  activePortFile: string | undefined
): CommandError | undefined {
  const cause = (error instanceof Error && error.cause instanceof Error ? error.cause : error) as
    (Error & { code?: string }) | undefined;
  const message = cause?.message ?? '';
  if (DECLINED_RESPONSE.test(message)) {
    return commandError(remoteDebuggingDeclinedError(), EXIT_CODES.PERMISSION_DENIED);
  }
  if (cause instanceof CDPTimeoutError || HANDSHAKE_TIMED_OUT.test(message)) {
    const seconds = Math.round(timeoutMs / 1000);
    return commandError(remoteDebuggingUnansweredError(seconds), EXIT_CODES.CDP_TIMEOUT);
  }
  if (activePortFile !== undefined && cause?.code === 'ECONNREFUSED') {
    const err = staleDevToolsActivePortError(activePortFile, new URL(wsUrl).host);
    return commandError(err, EXIT_CODES.RESOURCE_NOT_FOUND);
  }
  return undefined;
}

/**
 * A CommandError from a message and suggestion.
 *
 * @param err - Message and suggestion
 * @param exitCode - Exit code
 * @returns The error
 */
function commandError(
  err: { message: string; suggestion: string },
  exitCode: number
): CommandError {
  return new CommandError(err.message, { suggestion: err.suggestion }, exitCode);
}
