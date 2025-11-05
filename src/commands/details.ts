import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { getDetails } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/responseValidator.js';
import type { NetworkRequest, ConsoleMessage } from '@/types.js';
import { formatNetworkDetails, formatConsoleDetails } from '@/ui/formatters/details.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for details command.
 */
interface DetailsOptions extends BaseCommandOptions {
  /** Type of item ('network' or 'console') */
  type: 'network' | 'console';
  /** Request ID or console index */
  id: string;
}

/**
 * Result data containing the item and its type.
 */
interface DetailsResult {
  /** The network request or console message */
  item: NetworkRequest | ConsoleMessage;
  /** Type of item ('network' or 'console') */
  type: 'network' | 'console';
}

/**
 * Format details for human-readable output.
 * Dispatches to the appropriate formatter based on type.
 *
 * @param data - Details result containing item and type
 */
function formatDetails(data: DetailsResult): void {
  if (data.type === 'network') {
    console.log(formatNetworkDetails(data.item as NetworkRequest));
  } else {
    console.log(formatConsoleDetails(data.item as ConsoleMessage));
  }
}

/**
 * Register details command.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerDetailsCommand(program: Command): void {
  program
    .command('details')
    .description('Get detailed information for a specific request or console message')
    .argument('<type>', 'Type of item: "network" or "console"')
    .argument('<id>', 'Request ID (for network) or index (for console)')
    .addOption(jsonOption)
    .action(async (type: string, id: string, options: DetailsOptions) => {
      // Store arguments in options for handler (type assertion safe due to validation below)
      options.type = type as 'network' | 'console';
      options.id = id;

      await runCommand(
        async (opts) => {
          // Validate type argument
          if (opts.type !== 'network' && opts.type !== 'console') {
            return {
              success: false,
              error: `Unknown type: ${String(opts.type)}. Valid types: network, console`,
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
            };
          }

          // Fetch details via IPC from daemon/worker
          const response = await getDetails(opts.type, opts.id);

          // Validate IPC response (throws on error)
          validateIPCResponse(response);

          // Check for data in response
          if (!response.data?.item) {
            return {
              success: false,
              error: 'No data in response',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
            };
          }

          return {
            success: true,
            data: {
              item: response.data.item as unknown as NetworkRequest | ConsoleMessage,
              type: opts.type,
            },
          };
        },
        options,
        formatDetails
      );
    });
}
