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
import { launchDaemon, type SpawnedDaemon } from '@/daemon/launcher.js';
import {
  LAUNCHED_CHROME_DESCRIPTION,
  sessionAlreadyRunningError,
  alreadyRunningSuggestion,
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
import { getSessionName } from '@/session/paths.js';
import type { TelemetryType } from '@/types.js';
import { OutputBuilder, buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { escapeControlChars, joinLines } from '@/ui/formatting.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  daemonStillExitingHint,
  daemonStillExitingSuggestion,
  startNotices,
} from '@/ui/messages/session.js';
import { noActiveSessionMessage } from '@/ui/messages/sessionCommand.js';
import { delay, waitUntil } from '@/utils/async.js';
import { getExitCodeForIPCError } from '@/utils/errorMapping.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('bdg');

/**
 * Outcome of a start attempt, printed by {@link reportStartOutcome}.
 */
export type StartOutcome =
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
      /**
       * The daemon reported the failure or dropped the connection, so it is
       * exiting (a daemon this start spawned is then waited for)
       */
      daemonExiting?: boolean;
      /** The daemon this attempt spawned, when it is exiting */
      spawned?: SpawnedDaemon;
    };

/** How long a failed start waits for the daemons it spawned to exit */
export const SPAWNED_DAEMON_EXIT_WAIT_MS = 3000;

/** What a start uses to reach the daemon (replaced in tests) */
export interface StartDeps {
  /** Spawns the daemon if none runs ({@link launchDaemon}) */
  launch: () => Promise<SpawnedDaemon | undefined>;
  /** Sends `start_session_request` */
  send: typeof sendStartSessionRequest;
  /** How long a failed start waits for the daemons it spawned to exit */
  exitWaitMs: number;
}

const DEFAULT_START_DEPS: StartDeps = {
  launch: launchDaemon,
  send: sendStartSessionRequest,
  exitWaitMs: SPAWNED_DAEMON_EXIT_WAIT_MS,
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
  reportStartOutcome(await attemptStart(url, options, telemetry), options);
}

/**
 * Start a session, retrying while the previous session shuts down. After a
 * failure the daemon reported (or a dropped connection), it waits for every
 * daemon the attempts spawned to exit ({@link afterSpawnedDaemonExit}).
 *
 * @param url - Target URL
 * @param options - Session options
 * @param telemetry - Telemetry types
 * @param deps - How to reach the daemon (tests replace it)
 * @returns Start outcome, ready to report
 */
export async function attemptStart(
  url: string,
  options: SessionStartOptions,
  telemetry: TelemetryType[],
  deps: StartDeps = DEFAULT_START_DEPS
): Promise<StartOutcome> {
  const spawned: SpawnedDaemon[] = [];
  const attempt = async (): Promise<StartOutcome> => {
    const outcome = await requestSession(url, options, telemetry, deps);
    if (!outcome.ok && outcome.spawned) spawned.push(outcome.spawned);
    return outcome;
  };
  let outcome = await attempt();
  const deadline = Date.now() + SHUTDOWN_WAIT_MS;
  while (isShuttingDown(outcome) && Date.now() < deadline) {
    await delay(SHUTDOWN_POLL_MS);
    outcome = await attempt();
  }
  return afterSpawnedDaemonExit(outcome, spawned, deps.exitWaitMs);
}

/**
 * Let the daemons a failed start spawned finish exiting before the error is
 * reported: a daemon removes its session files on the way out, and a command
 * run right after (`bdg sessions`, another start) would otherwise still see
 * the session as starting. The wait is bounded; a daemon still running after
 * it is reported (`details.daemonStillRunning`, `daemonPid`, a suggestion).
 *
 * @param outcome - Start outcome
 * @param spawned - Exiting daemons the attempts spawned
 * @param waitMs - Milliseconds to wait at most for all of them
 * @returns The failure (without internal fields), with a hint when a daemon did not exit in time
 */
export async function afterSpawnedDaemonExit(
  outcome: StartOutcome,
  spawned: SpawnedDaemon[],
  waitMs: number
): Promise<StartOutcome> {
  if (outcome.ok) return outcome;
  const { spawned: _spawned, daemonExiting: _exiting, ...failure } = outcome;
  if (spawned.length === 0) return failure;
  if (await waitUntil(() => spawned.every((daemon) => daemon.hasExited()), waitMs)) {
    return failure;
  }
  const running = spawned.filter((daemon) => !daemon.hasExited()).pop();
  const suggestion = daemonStillExitingSuggestion();
  const previous = failure.details?.['suggestion'];
  return {
    ...failure,
    human: joinLines(
      failure.human,
      `${daemonStillExitingHint(running?.pid, waitMs)}; ${suggestion}`
    ),
    details: {
      ...failure.details,
      daemonStillRunning: true,
      ...(running?.pid !== undefined && { daemonPid: running.pid }),
      suggestion:
        typeof previous === 'string' && previous ? `${previous}; ${suggestion}` : suggestion,
    },
  };
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
  telemetry: TelemetryType[],
  deps: StartDeps
): Promise<StartOutcome> {
  let spawned: SpawnedDaemon | undefined;
  try {
    spawned = await deps.launch();
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

  const outcome = await sendStart(url, options, telemetry, deps.send);
  return !outcome.ok && outcome.daemonExiting && spawned ? { ...outcome, spawned } : outcome;
}

/**
 * Ask the running daemon to start a session.
 *
 * @param url - Target URL
 * @param options - Session options
 * @param telemetry - Telemetry types
 * @param send - Sends the request
 * @returns Start outcome; `daemonExiting` for a failure the daemon reported
 *   or a dropped connection, not for a timeout or an unexpected error (the
 *   daemon may still be starting the session then)
 */
async function sendStart(
  url: string,
  options: SessionStartOptions,
  telemetry: TelemetryType[],
  send: StartDeps['send']
): Promise<StartOutcome> {
  try {
    log.debug('Connecting to daemon...');
    const response = await send(
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
        viewport: options.viewport,
        colorScheme: options.colorScheme,
      })
    );
    if (response.status === 'error') {
      return { ...describeStartFailure(response, options), daemonExiting: true };
    }
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
        error: `${noActiveSessionMessage()} (daemon not running)`,
        human: daemonNotRunningError({ suggestStatus: true, suggestRetry: true }),
        exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
        retryable: true,
        daemonExiting: true,
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
): Extract<StartOutcome, { ok: false }> {
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
      details: { ...details, suggestion: alreadyRunningSuggestion() },
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
  const session = getSessionName() ?? undefined;
  if (options.json) {
    const result = {
      ...(session && { session }),
      targetUrl: data.targetUrl,
      ...(data.targetTitle !== undefined && { targetTitle: data.targetTitle }),
      ...(data.documentStatus !== undefined && { documentStatus: data.documentStatus }),
      ...(data.loading && { loading: data.loading }),
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
      ...(data.loading && { loading: data.loading }),
      ...(autoStopAt && { autoStopAt }),
      ...(session && { session }),
    };
    const text = options.quiet
      ? [`Session started: ${data.targetUrl}`, ...startNotices(page)].join('\n')
      : landingPage(page);
    console.error(escapeControlChars(text));
  }
  process.exit(EXIT_CODES.SUCCESS);
}
