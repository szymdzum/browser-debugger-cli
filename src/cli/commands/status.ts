import type { Command } from 'commander';

import {
  formatSessionStatus,
  formatStatusAsJson,
  formatNoSessionMessage,
} from '@/cli/formatters/statusFormatter.js';
import { getStatus } from '@/ipc/client.js';
import type { SessionMetadata } from '@/session';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

/**
 * Options for the `bdg status` command.
 * @property json    Print structured JSON instead of the default human output.
 * @property verbose Show detailed Chrome diagnostics (binary path, port, PID).
 */
interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Register status command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show active session status and collection statistics')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed Chrome diagnostics')
    .action(async (options: StatusOptions) => {
      try {
        // Request status from daemon via IPC
        const response = await getStatus();

        // Handle IPC error response
        if (response.status === 'error') {
          console.error(`Daemon error: ${response.error ?? 'Unknown error'}`);
          process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
        }

        // Extract data from response
        const { data } = response;
        if (!data) {
          console.error('Invalid response from daemon: missing data');
          process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
        }

        // Check if there's an active session
        if (!data.sessionPid || !data.sessionMetadata) {
          if (options.json) {
            console.log(JSON.stringify({ version: VERSION, active: false }, null, 2));
          } else {
            console.error(formatNoSessionMessage());
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Convert IPC metadata to SessionMetadata format
        const metadata: SessionMetadata = {
          bdgPid: data.sessionMetadata.bdgPid,
          chromePid: data.sessionMetadata.chromePid,
          startTime: data.sessionMetadata.startTime,
          port: data.sessionMetadata.port,
          targetId: data.sessionMetadata.targetId,
          webSocketDebuggerUrl: data.sessionMetadata.webSocketDebuggerUrl,
          activeCollectors: data.sessionMetadata.activeCollectors,
        };

        if (options.json) {
          // JSON output
          const jsonOutput = formatStatusAsJson(metadata, data.sessionPid);
          console.log(JSON.stringify(jsonOutput, null, 2));
        } else {
          // Human-readable output
          console.log(formatSessionStatus(metadata, data.sessionPid, options.verbose ?? false));
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (error) {
        // Handle connection errors (daemon not running)
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('ENOENT') || errorMessage.includes('ECONNREFUSED')) {
          console.error('Daemon not running. Start it with: bdg <url>');
          process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        console.error(`Error checking status: ${errorMessage}`);
        process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
      }
    });
}
