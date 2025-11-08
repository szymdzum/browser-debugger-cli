import { landingPage } from '@/commands/shared/landingPage.js';
import { startSession as sendStartSessionRequest } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/types.js';
import type { TelemetryType } from '@/types.js';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  sessionAlreadyRunningError,
  daemonConnectionFailedError,
  invalidResponseError,
  genericError,
} from '@/ui/messages/errors.js';
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
  options: {
    port: number;
    timeout: number | undefined;
    userDataDir: string | undefined;
    includeAll: boolean;
    maxBodySize: number | undefined;
    compact: boolean;
    headless: boolean;
    chromeWsUrl: string | undefined;
  },
  telemetry: TelemetryType[]
): Promise<void> {
  try {
    log.debug('Connecting to daemon...');

    // Send start_session_request to daemon
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
      })
    );

    // Check for errors
    if (response.status === 'error') {
      // Special handling for SESSION_ALREADY_RUNNING with helpful context
      if (response.errorCode === IPCErrorCode.SESSION_ALREADY_RUNNING && response.existingSession) {
        const { pid, targetUrl, duration } = response.existingSession;
        const durationMs = duration ? duration * 1000 : 0;
        console.error(sessionAlreadyRunningError(pid, durationMs, targetUrl));
      } else {
        console.error(genericError(`Daemon error: ${response.message ?? 'Unknown error'}`));
      }
      process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    // Extract metadata from response
    const { data } = response;
    if (!data) {
      console.error(invalidResponseError('missing data'));
      process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    // Display landing page with session information
    const landing = landingPage({
      url: data.targetUrl,
    });

    console.error(landing);

    // Session runs in background worker - CLI exits immediately
    // This allows user to run other commands in the same terminal
    process.exit(0);
  } catch (error) {
    // Handle connection errors
    const errorMessage = getErrorMessage(error);

    if (errorMessage.includes('ENOENT') || errorMessage.includes('ECONNREFUSED')) {
      console.error(daemonConnectionFailedError());
      process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    console.error(genericError(errorMessage));
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}
