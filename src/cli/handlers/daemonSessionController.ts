import { startSession as sendStartSessionRequest } from '@/ipc/client.js';
import { IPCErrorCode } from '@/ipc/types.js';
import type { CollectorType } from '@/types.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
    console.error('[bdg] Connecting to daemon...');

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

    // Output session information
    console.error(`[bdg] Session started via daemon`);
    console.error(`[bdg] Worker PID: ${data.workerPid}`);
    console.error(`[bdg] Chrome PID: ${data.chromePid}`);
    console.error(`[bdg] Target: ${data.targetUrl}`);
    if (data.targetTitle) {
      console.error(`[bdg] Title: ${data.targetTitle}`);
    }

    const collectorNames =
      collectors.length === 3 ? 'network, console, and DOM' : collectors.join(', ');

    if (options.timeout) {
      console.error(
        `[bdg] Collecting ${collectorNames} for ${options.timeout}s... ` +
          `(auto-stop on timeout, or use 'bdg stop' to stop early)`
      );
    } else {
      console.error(
        `[bdg] Collecting ${collectorNames}... ` + `(use 'bdg stop' when ready to stop and output)`
      );
    }

    console.error('');
    console.error('Available commands:');
    console.error('  bdg status              Show session status');
    console.error('  bdg peek                Preview collected data');
    console.error('  bdg query <script>      Execute JavaScript in browser');
    console.error('  bdg stop                Stop session and output results');
    console.error('');

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
