/**
 * Start command helper functions.
 *
 * Command-specific logic for the `bdg start` command.
 * Handles IPC communication with daemon to start browser sessions.
 */

import { timeoutError } from '@/commands/shared/CommandRunner.js';
import { landingPage } from '@/commands/shared/landingPage.js';
import type { SessionStartOptions } from '@/commands/shared/optionTypes.js';
import { DaemonError, SessionDirError } from '@/daemon/errors.js';
import { launchDaemon } from '@/daemon/launcher.js';
import {
  LAUNCHED_CHROME_DESCRIPTION,
  sessionAlreadyRunningError,
  ALREADY_RUNNING_SUGGESTION,
  sessionTargetMismatchError,
  daemonNotRunningError,
  invalidResponseError,
  genericError,
} from '@/errors/messages.js';
import { startSession as sendStartSessionRequest } from '@/ipc/client.js';
import {
  IPCErrorCode,
  type StartSessionResponse,
  type StartSessionResponseData,
} from '@/ipc/index.js';
import { IPCTimeoutError } from '@/ipc/transport/index.js';
import { isConnectionError } from '@/ipc/utils/errors.js';
import type { TelemetryType } from '@/types.js';
import { OutputBuilder, buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { escapeControlChars, joinLines } from '@/ui/formatting.js';
import { createLogger } from '@/ui/logging/index.js';
import { startNotices } from '@/ui/messages/session.js';
import { delay } from '@/utils/async.js';
import { getExitCodeForIPCError } from '@/utils/errorMapping.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('bdg');

/**
 * Outcome of a start attempt, printed by {@link reportStartOutcome}.
 */
type StartOutcome =
  | { ok: true; data: StartSessionResponseData }
  | {
      ok: false;
      /** Message for `--json` (no "Error:" prefix) */
      error: string;
      /** Full human-readable message */
      human: string;
      exitCode: number;
      /** Daemon's error code (internal: not printed) */
      errorCode?: IPCErrorCode | undefined;
      /** Extra fields of the JSON error envelope */
      details?: Record<string, unknown>;
      /** The daemon went away mid-request (e.g. the previous session was ending) */
      retryable?: boolean;
    };

/**
 * Start a session via the daemon and report the result.
 *
 * Spawns the daemon if needed, sends `start_session_request`, then prints the
 * result as a JSON envelope (`--json`) or human-readable text, and exits.
 *
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @param telemetry - Array of telemetry types to enable
 */
export async function startSessionViaDaemon(
  url: string,
  options: SessionStartOptions,
  telemetry: TelemetryType[]
): Promise<never> {
  process.once('SIGINT', () => reportStartOutcome(interruptedOutcome('SIGINT'), options));
  process.once('SIGTERM', () => reportStartOutcome(interruptedOutcome('SIGTERM'), options));
  let outcome = await requestSession(url, options, telemetry);
  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (isShuttingDown(outcome) && Date.now() < deadline) {
    await delay(SHUTDOWN_POLL_MS);
    outcome = await requestSession(url, options, telemetry);
  }
  reportStartOutcome(outcome, options);
}

/**
 * The outcome of a start interrupted with Ctrl-C (the daemon notices the
 * closed connection and cancels the start).
 *
 * @param signal - The signal that stopped the start
 * @returns Failed start outcome (exit 130)
 */
function interruptedOutcome(signal: 'SIGINT' | 'SIGTERM'): StartOutcome {
  const message = `Start cancelled (${signal === 'SIGINT' ? 'interrupted' : 'terminated'})`;
  const exitCode = signal === 'SIGINT' ? EXIT_CODES.INTERRUPTED : EXIT_CODES.TERMINATED;
  return { ok: false, error: message, human: message, exitCode };
}

/** How long a new start waits for the previous session to finish shutting down */
const SHUTDOWN_WAIT_MS = 15000;

/** Interval between start attempts while the previous session shuts down */
const SHUTDOWN_POLL_MS = 200;

/**
 * Whether the start failed only because the previous session is still
 * shutting down (e.g. `bdg stop` was just run), or its daemon exited while
 * answering: the start is retried until the old daemon is gone and a new one
 * can be launched.
 *
 * @param outcome - Start outcome
 * @returns True if waiting and retrying can succeed
 */
function isShuttingDown(outcome: StartOutcome): boolean {
  return (
    !outcome.ok &&
    (outcome.retryable === true || outcome.errorCode === IPCErrorCode.SESSION_SHUTTING_DOWN)
  );
}

/**
 * Launch the daemon if needed and ask it to start a session.
 *
 * @param url - Target URL
 * @param options - Session options
 * @param telemetry - Telemetry types
 * @returns Start outcome
 */
async function requestSession(
  url: string,
  options: SessionStartOptions,
  telemetry: TelemetryType[]
): Promise<StartOutcome> {
  try {
    await launchDaemon();
  } catch (error) {
    if (error instanceof SessionDirError) {
      return {
        ok: false,
        error: error.message,
        human: joinLines(genericError(error.message), error.suggestion),
        exitCode: error.exitCode,
        details: { suggestion: error.suggestion },
      };
    }
    const message = `Failed to start daemon: ${getErrorMessage(error)}`;
    const exitCode = error instanceof DaemonError ? error.exitCode : EXIT_CODES.SOFTWARE_ERROR;
    return { ok: false, error: message, human: genericError(message), exitCode };
  }

  try {
    log.debug('Connecting to daemon...');
    const response = await sendStartSessionRequest(
      url,
      filterDefined({
        port: options.port,
        timeout: options.timeout,
        telemetry: telemetry.length > 0 ? telemetry : undefined,
        includeAll: options.includeAll,
        userDataDir: options.userDataDir,
        maxBodySize: options.maxBodySize,
        headless: options.headless,
        chromeWsUrl: options.chromeWsUrl,
        chromeFlags: options.chromeFlags,
      })
    );
    if (response.status === 'error') return describeStartFailure(response, options);
    if (!response.data) {
      const message = 'Invalid response from daemon: missing data';
      return {
        ok: false,
        error: message,
        human: invalidResponseError('missing data'),
        exitCode: EXIT_CODES.SOFTWARE_ERROR,
      };
    }
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof IPCTimeoutError) {
      const timeout = timeoutError(error);
      return {
        ok: false,
        error: timeout.message,
        human: joinLines(genericError(timeout.message), String(timeout.metadata.suggestion)),
        exitCode: timeout.exitCode,
        details: { suggestion: timeout.metadata.suggestion },
      };
    }
    if (isConnectionError(error)) {
      return {
        ok: false,
        error: 'No active session (daemon not running)',
        human: daemonNotRunningError({ suggestStatus: true, suggestRetry: true }),
        exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
        retryable: true,
      };
    }
    const message = getErrorMessage(error);
    return {
      ok: false,
      error: message,
      human: genericError(message),
      exitCode: EXIT_CODES.SOFTWARE_ERROR,
    };
  }
}

/**
 * The existing session without its `duration` (seconds), which is reported
 * as `durationMs` like every other duration.
 *
 * @param existing - Existing session from the daemon
 * @returns The other fields
 */
function omitDuration(
  existing: NonNullable<StartSessionResponse['existingSession']>
): Omit<NonNullable<StartSessionResponse['existingSession']>, 'duration'> {
  const { duration: _duration, ...rest } = existing;
  return rest;
}

/**
 * Describe an error response to `start_session_request`.
 *
 * @param response - Error response from the daemon
 * @param options - Session options (for target-mismatch wording)
 * @returns Failed start outcome
 */
function describeStartFailure(
  response: StartSessionResponse,
  options: SessionStartOptions
): StartOutcome {
  const exitCode = response.exitCode ?? getExitCodeForIPCError(response.errorCode);
  const existing = response.existingSession;
  const details = filterDefined({
    existingSession: existing && {
      ...omitDuration(existing),
      ...(existing.duration !== undefined && { durationMs: existing.duration * 1000 }),
    },
  });
  if (response.errorCode === IPCErrorCode.SESSION_ALREADY_RUNNING && existing) {
    const { pid, targetUrl, duration } = existing;
    return {
      ok: false,
      error: response.message ?? 'Session already running',
      human: sessionAlreadyRunningError(pid, duration ? duration * 1000 : 0, targetUrl),
      exitCode,
      errorCode: response.errorCode,
      details: { ...details, suggestion: ALREADY_RUNNING_SUGGESTION },
    };
  }
  if (response.errorCode === IPCErrorCode.SESSION_TARGET_MISMATCH) {
    // Absent existingSession.targetUrl signals launched-mode current — the
    // daemon omits it in that case to keep targetUrl URL-shaped for agents.
    const current = response.existingSession?.targetUrl ?? LAUNCHED_CHROME_DESCRIPTION;
    const requested = options.chromeWsUrl ?? LAUNCHED_CHROME_DESCRIPTION;
    return {
      ok: false,
      error: response.message ?? 'Session target mismatch',
      human: sessionTargetMismatchError(current, requested),
      exitCode,
      errorCode: response.errorCode,
      details,
    };
  }
  const message = response.message ?? 'Unknown error';
  const [error = message, ...hint] = message.split('\n');
  return {
    ok: false,
    error,
    human: genericError(message),
    exitCode,
    errorCode: response.errorCode,
    details: {
      ...details,
      ...(hint.join('\n').trim() && { suggestion: hint.join('\n').trim() }),
    },
  };
}

/**
 * Print a start outcome and exit.
 *
 * @param outcome - Start outcome
 * @param options - Session options (json/quiet)
 */
function reportStartOutcome(outcome: StartOutcome, options: SessionStartOptions): never {
  if (!outcome.ok) {
    if (options.json) {
      const envelope = OutputBuilder.buildJsonError(outcome.error, {
        exitCode: outcome.exitCode,
        ...outcome.details,
      });
      console.log(JSON.stringify(envelope, null, 2));
    } else {
      console.error(escapeControlChars(outcome.human));
    }
    process.exit(outcome.exitCode);
  }

  const { data } = outcome;
  const autoStopAt =
    options.timeout !== undefined ? new Date(Date.now() + options.timeout * 1000) : undefined;
  if (options.json) {
    const result = {
      targetUrl: data.targetUrl,
      ...(data.targetTitle !== undefined && { targetTitle: data.targetTitle }),
      ...(data.documentStatus !== undefined && { documentStatus: data.documentStatus }),
      port: data.port,
      ...(data.chromePid > 0 ? { chromePid: data.chromePid } : { externalChrome: true }),
      daemonPid: data.daemonPid,
      ...(autoStopAt && { autoStopAt: autoStopAt.toISOString() }),
    };
    console.log(JSON.stringify(buildSuccessResponse(result), null, 2));
  } else {
    const page = {
      url: data.targetUrl,
      ...(data.documentStatus !== undefined && { documentStatus: data.documentStatus }),
      ...(autoStopAt && { autoStopAt }),
    };
    const text = options.quiet
      ? [`Session started: ${data.targetUrl}`, ...startNotices(page)].join('\n')
      : landingPage(page);
    console.error(escapeControlChars(text));
  }
  process.exit(EXIT_CODES.SUCCESS);
}
