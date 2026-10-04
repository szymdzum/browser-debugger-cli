/**
 * Start command helper functions.
 *
 * Command-specific logic for the `bdg start` command.
 * Handles IPC communication with daemon to start browser sessions.
 */

import { landingPage } from '@/commands/shared/landingPage.js';
import type { SessionStartOptions } from '@/commands/shared/optionTypes.js';
import { DaemonError } from '@/daemon/errors.js';
import { launchDaemon } from '@/daemon/launcher.js';
import {
  LAUNCHED_CHROME_DESCRIPTION,
  sessionAlreadyRunningError,
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
import { isConnectionError } from '@/ipc/utils/errors.js';
import type { TelemetryType } from '@/types.js';
import { OutputBuilder, buildSuccessResponse } from '@/ui/OutputBuilder.js';
import { createLogger } from '@/ui/logging/index.js';
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
      details?: Record<string, unknown>;
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
  const outcome = await requestSession(url, options, telemetry);
  reportStartOutcome(outcome, options);
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
    if (isConnectionError(error)) {
      return {
        ok: false,
        error: 'No active session (daemon not running)',
        human: daemonNotRunningError({ suggestStatus: true, suggestRetry: true }),
        exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
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
  const exitCode = getExitCodeForIPCError(response.errorCode);
  const details = filterDefined({
    errorCode: response.errorCode,
    existingSession: response.existingSession,
  });
  if (response.errorCode === IPCErrorCode.SESSION_ALREADY_RUNNING && response.existingSession) {
    const { pid, targetUrl, duration } = response.existingSession;
    return {
      ok: false,
      error: response.message ?? 'Session already running',
      human: sessionAlreadyRunningError(pid, duration ? duration * 1000 : 0, targetUrl),
      exitCode,
      details,
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
    details: { ...details, ...(hint.length > 0 && { suggestion: hint.join('\n') }) },
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
      console.error(outcome.human);
    }
    process.exit(outcome.exitCode);
  }

  const { data } = outcome;
  if (options.json) {
    const result = {
      targetUrl: data.targetUrl,
      ...(data.targetTitle !== undefined && { targetTitle: data.targetTitle }),
      ...(data.documentStatus !== undefined && { documentStatus: data.documentStatus }),
      port: data.port,
      chromePid: data.chromePid,
      daemonPid: data.daemonPid,
    };
    console.log(JSON.stringify(buildSuccessResponse(result), null, 2));
  } else if (options.quiet) {
    console.error(`Session started: ${data.targetUrl}`);
  } else {
    console.error(
      landingPage({
        url: data.targetUrl,
        ...(data.documentStatus !== undefined && { documentStatus: data.documentStatus }),
      })
    );
  }
  process.exit(EXIT_CODES.SUCCESS);
}
