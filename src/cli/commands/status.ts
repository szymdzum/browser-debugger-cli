import { Command } from 'commander';

import { readPid, isProcessAlive } from '@/utils/session.js';
import {
  formatSessionStatus,
  formatStatusAsJson,
  formatNoSessionMessage,
  formatStaleSessionMessage,
  formatNoMetadataMessage
} from '@/cli/formatters/statusFormatter.js';

/**
 * Register status command
 */
export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show active session status and collection statistics')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
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
            console.log(JSON.stringify({
              active: true,
              bdgPid: pid,
              warning: 'Metadata not found (session may be from older version)'
            }, null, 2));
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
          console.log(formatSessionStatus(metadata, pid));
        }

        process.exit(0);
      } catch (error) {
        console.error(`Error checking status: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
