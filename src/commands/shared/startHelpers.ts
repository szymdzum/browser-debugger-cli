/**
 * Start command helper functions.
 *
 * Command-specific logic for the `bdg start` command.
 * Handles IPC communication with daemon to start browser sessions.
 */

import { landingPage } from '@/commands/shared/landingPage.js';
import type { SessionStartOptions } from '@/commands/shared/optionTypes.js';

/**
 * Decide whether the post-start landing page should print.
 *
 * Humans sitting at an interactive terminal benefit from the one-time
 * walkthrough of next-step commands, but scripts and CI logs end up with
 * 50+ lines of decorative text that drowns the actual session output.
 * Use stdout's TTY status as the signal, with explicit --verbose /
 * --quiet overrides for users who want to force either outcome.
 */
function shouldShowLandingPage(options: SessionStartOptions): boolean {
  if (options.quiet) return false;
  if (options.verbose) return true;
  return process.stdout.isTTY === true;
}
import {
  LAUNCHED_CHROME_DESCRIPTION,
  sessionAlreadyRunningError,
  sessionTargetMismatchError,
  daemonNotRunningError,
  invalidResponseError,
  genericError,
} from '@/errors/messages.js';
import { startSession as sendStartSessionRequest } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/index.js';
import { isConnectionError } from '@/ipc/utils/errors.js';
import type { TelemetryType } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getExitCodeForIPCError } from '@/utils/errorMapping.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

const log = createLogger('bdg');

/**
 * Start a session via the daemon using IPC.
 *
 * This replaces the in-process sessionController.startSession() by:
 * 1. Sending a start_session_request to the daemon
 * 2. Waiting for the worker to launch and report readiness
 * 3. Outputting metadata about the running session
 * 4. Keeping the process alive while the session runs
 *
 * @param url - Target URL to navigate to
 * @param options - Session configuration options
 * @param telemetry - Array of telemetry types to enable
 */
export async function startSessionViaDaemon(
  url: string,
  options: SessionStartOptions,
  telemetry: TelemetryType[]
): Promise<void> {
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

    if (response.status === 'error') {
      if (response.errorCode === IPCErrorCode.SESSION_ALREADY_RUNNING && response.existingSession) {
        const { pid, targetUrl, duration } = response.existingSession;
        const durationMs = duration ? duration * 1000 : 0;
        console.error(genericError(sessionAlreadyRunningError(pid, durationMs, targetUrl)));
      } else if (response.errorCode === IPCErrorCode.SESSION_TARGET_MISMATCH) {
        // Absent existingSession.targetUrl signals launched-mode current — the
        // daemon omits it in that case to keep targetUrl URL-shaped for agents.
        const current = response.existingSession?.targetUrl ?? LAUNCHED_CHROME_DESCRIPTION;
        const requested = options.chromeWsUrl ?? LAUNCHED_CHROME_DESCRIPTION;
        console.error(genericError(sessionTargetMismatchError(current, requested)));
      } else {
        console.error(genericError(`Daemon error: ${response.message ?? 'Unknown error'}`));
      }
      process.exit(getExitCodeForIPCError(response.errorCode));
    }

    const { data } = response;
    if (!data) {
      console.error(invalidResponseError('missing data'));
      process.exit(EXIT_CODES.SOFTWARE_ERROR);
    }

    if (shouldShowLandingPage(options)) {
      const landing = landingPage({
        url: data.targetUrl,
      });
      console.error(landing);
    } else if (!options.quiet) {
      console.error(`Session started: ${data.targetUrl}`);
    }

    process.exit(0);
  } catch (error) {
    if (isConnectionError(error)) {
      console.error(
        genericError(daemonNotRunningError({ suggestStatus: true, suggestRetry: true }))
      );
      process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
    }

    console.error(genericError(getErrorMessage(error)));
    process.exit(EXIT_CODES.SOFTWARE_ERROR);
  }
}
