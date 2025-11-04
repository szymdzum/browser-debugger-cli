import type { Command } from 'commander';

import { formatNetworkDetails, formatConsoleDetails } from '@/cli/formatters/detailsFormatter.js';
import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { getDetails } from '@/ipc/client.js';
import type { NetworkRequest, ConsoleMessage } from '@/types.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Optional switches for `bdg details`.
 */
interface DetailsOptions {
  /** Emit the selected record as JSON instead of formatted text. */
  json?: boolean;
}

/**
 * Register details command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerDetailsCommand(program: Command): void {
  program
    .command('details')
    .description('Get detailed information for a specific request or console message')
    .argument('<type>', 'Type of item: "network" or "console"')
    .argument('<id>', 'Request ID (for network) or index (for console)')
    .option('-j, --json', 'Output as JSON')
    .action(async (type: string, id: string, options: DetailsOptions) => {
      try {
        // Validate type
        if (type !== 'network' && type !== 'console') {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(`Unknown type: ${type}`, {
                  validTypes: ['network', 'console'],
                }),
                null,
                2
              )
            );
          } else {
            console.error(`Unknown type: ${type}`);
            console.error('Valid types: network, console');
          }
          process.exit(EXIT_CODES.INVALID_ARGUMENTS);
        }

        // Fetch details via IPC from daemon/worker
        const response = await getDetails(type, id);

        if (response.status === 'error') {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(response.error ?? 'Unknown error', {
                  suggestion:
                    type === 'network'
                      ? 'List requests: bdg peek --network'
                      : 'List messages: bdg peek --console',
                }),
                null,
                2
              )
            );
          } else {
            console.error(`Error: ${response.error ?? 'Unknown error'}`);
            console.error('\nTry:');
            console.error(
              type === 'network'
                ? '  List requests:  bdg peek --network'
                : '  List messages:  bdg peek --console'
            );
          }
          process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        if (!response.data?.item) {
          if (options.json) {
            console.log(
              JSON.stringify(OutputBuilder.buildJsonError('No data in response'), null, 2)
            );
          } else {
            console.error('Error: No data in response');
          }
          process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        // Format and display the item
        if (type === 'network') {
          const request = response.data.item as NetworkRequest;
          if (options.json) {
            console.log(JSON.stringify(request, null, 2));
          } else {
            console.log(formatNetworkDetails(request));
          }
        } else {
          const message = response.data.item as ConsoleMessage;
          if (options.json) {
            console.log(JSON.stringify(message, null, 2));
          } else {
            console.log(formatConsoleDetails(message));
          }
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonError(`Error fetching details: ${getErrorMessage(error)}`),
              null,
              2
            )
          );
        } else {
          console.error(`Error fetching details: ${getErrorMessage(error)}`);
        }
        process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
      }
    });
}
