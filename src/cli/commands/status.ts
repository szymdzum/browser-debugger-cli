import type { Command } from 'commander';

import {
  formatSessionStatus,
  formatStatusAsJson,
  formatNoSessionMessage,
  formatStaleSessionMessage,
  formatNoMetadataMessage,
} from '@/cli/formatters/statusFormatter.js';
import { readPid, isProcessAlive } from '@/utils/session.js';

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
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show active session status and collection statistics')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed Chrome diagnostics')
    .action(async (options: StatusOptions) => {
      try {
        const { readSessionMetadata } = await import('@/utils/session.js');

        // Read PID
        const pid = readPid();

        if (!pid) {
          if (options.json) {
            console.log(JSON.stringify({ active: false }, null, 2));
          } else {
            console.error(formatNoSessionMessage());
          }
          process.exit(0);
        }

        // Check if process is alive
        const isAlive = isProcessAlive(pid);

        if (!isAlive) {
          if (options.json) {
            console.log(JSON.stringify({ active: false, stale: true, stalePid: pid }, null, 2));
          } else {
            console.error(formatStaleSessionMessage(pid));
          }
          process.exit(0);
        }

        // Read metadata
        const metadata = readSessionMetadata();

        if (!metadata) {
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  active: true,
                  bdgPid: pid,
                  warning: 'Metadata not found (session may be from older version)',
                },
                null,
                2
              )
            );
          } else {
            console.error(formatNoMetadataMessage(pid));
          }
          process.exit(0);
        }

        if (options.json) {
          // JSON output
          const jsonOutput = formatStatusAsJson(metadata, pid);
          console.log(JSON.stringify(jsonOutput, null, 2));
        } else {
          // Human-readable output
          console.log(formatSessionStatus(metadata, pid, options.verbose ?? false));
        }

        process.exit(0);
      } catch (error) {
        console.error(
          `Error checking status: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
