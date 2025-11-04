import type { Command } from 'commander';

import { formatNetworkDetails, formatConsoleDetails } from '@/cli/formatters/detailsFormatter.js';
import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { readFullOutput } from '@/session/output.js';
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
    .action((type: string, id: string, options: DetailsOptions) => {
      try {
        const fullOutput = readFullOutput();

        if (!fullOutput) {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError('No detailed data available', {
                  note: 'Session may not be running or data not yet written',
                  suggestions: ['Check session status: bdg status', 'Start a session: bdg <url>'],
                }),
                null,
                2
              )
            );
          } else {
            console.error('No detailed data available');
            console.error('Session may not be running or data not yet written');
            console.error('\nSuggestions:');
            console.error('  Check session status:  bdg status');
            console.error('  Start a session:       bdg <url>');
          }
          process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        if (type === 'network') {
          // Find network request by ID
          const request = fullOutput.data.network?.find((req) => req.requestId === id);

          if (!request) {
            if (options.json) {
              console.log(
                JSON.stringify(
                  OutputBuilder.buildJsonError(`Network request not found: ${id}`, {
                    suggestion: 'List requests: bdg peek --network',
                  }),
                  null,
                  2
                )
              );
            } else {
              console.error(`Network request not found: ${id}`);
              console.error('\nTry:');
              console.error('  List requests:  bdg peek --network');
            }
            process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
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
            if (options.json) {
              console.log(
                JSON.stringify(
                  OutputBuilder.buildJsonError(`Invalid console index: ${id}`),
                  null,
                  2
                )
              );
            } else {
              console.error(`Invalid console index: ${id}`);
            }
            process.exit(EXIT_CODES.INVALID_ARGUMENTS);
          }

          const message = fullOutput.data.console?.[index];

          if (!message) {
            if (options.json) {
              console.log(
                JSON.stringify(
                  OutputBuilder.buildJsonError(`Console message not found at index: ${index}`, {
                    availableRange: `0-${(fullOutput.data.console?.length ?? 0) - 1}`,
                    suggestion: 'List messages: bdg peek --console',
                  }),
                  null,
                  2
                )
              );
            } else {
              console.error(`Console message not found at index: ${index}`);
              console.error(`Available range: 0-${(fullOutput.data.console?.length ?? 0) - 1}`);
              console.error('\nTry:');
              console.error('  List messages:  bdg peek --console');
            }
            process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
          }

          if (options.json) {
            console.log(JSON.stringify(message, null, 2));
          } else {
            console.log(formatConsoleDetails(message));
          }
        } else {
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
