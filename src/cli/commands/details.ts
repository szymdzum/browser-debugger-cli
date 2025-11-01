import type { Command } from 'commander';

import { formatNetworkDetails, formatConsoleDetails } from '@/cli/formatters/detailsFormatter.js';
import { readFullOutput } from '@/utils/session.js';

interface DetailsOptions {
  json?: boolean;
}

/**
 * Register details command
 */
export function registerDetailsCommand(program: Command): void {
  program
    .command('details')
    .description('Get detailed information for a specific request or console message')
    .argument('<type>', 'Type of item: "network" or "console"')
    .argument('<id>', 'Request ID (for network) or index (for console)')
    .option('-j, --json', 'Output as JSON')
    .action((type: string, id: string, options: DetailsOptions) => {
      try {
        const fullOutput = readFullOutput();

        if (!fullOutput) {
          console.error('No detailed data available');
          console.error('Session may not be running or data not yet written');
          console.error('\n💡 Suggestions:');
          console.error('  Check session status:  bdg status');
          console.error('  Start a session:       bdg <url>');
          process.exit(1);
        }

        if (type === 'network') {
          // Find network request by ID
          const request = fullOutput.data.network?.find((req) => req.requestId === id);

          if (!request) {
            console.error(`Network request not found: ${id}`);
            console.error('\n💡 Try:');
            console.error('  List requests:  bdg peek --network');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify(request, null, 2));
          } else {
            console.log(formatNetworkDetails(request));
          }
        } else if (type === 'console') {
          // Find console message by index
          const index = parseInt(id);
          if (isNaN(index)) {
            console.error(`Invalid console index: ${id}`);
            process.exit(1);
          }

          const message = fullOutput.data.console?.[index];

          if (!message) {
            console.error(`Console message not found at index: ${index}`);
            console.error(`Available range: 0-${(fullOutput.data.console?.length ?? 0) - 1}`);
            console.error('\n💡 Try:');
            console.error('  List messages:  bdg peek --console');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify(message, null, 2));
          } else {
            console.log(formatConsoleDetails(message));
          }
        } else {
          console.error(`Unknown type: ${type}`);
          console.error('Valid types: network, console');
          process.exit(1);
        }

        process.exit(0);
      } catch (error) {
        console.error(
          `Error fetching details: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
