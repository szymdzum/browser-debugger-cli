import { landingPage } from '@/cli/handlers/landingPage.js';
import { startSession as sendStartSessionRequest } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/types.js';
import type { CollectorType } from '@/types.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { createLogger } from '@/utils/logger.js';

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
 * @param collectors - Array of collector types to enable
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
  },
  collectors: CollectorType[]
): Promise<void> {
  try {
    log.debug('Connecting to daemon...');

    // Send start_session_request to daemon
    const requestOptions: {
      port?: number;
      timeout?: number;
      collectors?: CollectorType[];
      includeAll?: boolean;
      userDataDir?: string;
      maxBodySize?: number;
    } = {};

    if (options.port !== undefined) requestOptions.port = options.port;
    if (options.timeout !== undefined) requestOptions.timeout = options.timeout;
    if (collectors.length > 0) requestOptions.collectors = collectors;
    if (options.includeAll !== undefined) requestOptions.includeAll = options.includeAll;
    if (options.userDataDir !== undefined) requestOptions.userDataDir = options.userDataDir;
    if (options.maxBodySize !== undefined) requestOptions.maxBodySize = options.maxBodySize;

    const response = await sendStartSessionRequest(url, requestOptions);

    // Check for errors
    if (response.status === 'error') {
      // Special handling for SESSION_ALREADY_RUNNING with helpful context
      if (response.errorCode === IPCErrorCode.SESSION_ALREADY_RUNNING && response.existingSession) {
        const { pid, targetUrl, duration } = response.existingSession;
        const durationStr = duration
          ? duration < 60
            ? `${duration}s`
            : `${Math.floor(duration / 60)}m ${duration % 60}s`
          : 'unknown';

        console.error(`\nError: Session already running`);
        console.error(`  PID:      ${pid}`);
        if (targetUrl) {
          console.error(`  Target:   ${targetUrl}`);
        }
        console.error(`  Duration: ${durationStr}`);
        console.error(``);
        console.error(`Suggestions:`);
        console.error(`  View session:     bdg status`);
        console.error(`  Stop and restart: bdg stop && bdg ${url}`);
        console.error(``);
      } else {
        console.error(`[bdg] Daemon error: ${response.message ?? 'Unknown error'}`);
      }
      process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    // Extract metadata from response
    const { data } = response;
    if (!data) {
      console.error('[bdg] Invalid response from daemon: missing data');
      process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    // Display landing page with session information
    const landing = landingPage({
      url: data.targetUrl,
      workerPid: data.workerPid,
      chromePid: data.chromePid,
      collectors,
    });

    console.error(landing);

    // Session runs in background worker - CLI exits immediately
    // This allows user to run other commands in the same terminal
    process.exit(0);
  } catch (error) {
    // Handle connection errors
    const errorMessage = getErrorMessage(error);

    if (errorMessage.includes('ENOENT') || errorMessage.includes('ECONNREFUSED')) {
      console.error('[bdg] Daemon not running');
      console.error('[bdg] Try running the command again or check daemon status with: bdg status');
      process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
    }

    console.error(`[bdg] Error: ${errorMessage}`);
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  }
}
