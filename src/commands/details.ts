import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { DetailsCommandOptions } from '@/commands/shared/optionTypes.js';
import type { DetailsResult } from '@/commands/types.js';
import { getDetails } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { NetworkRequest, ConsoleMessage } from '@/types.js';
import { formatNetworkDetails, formatConsoleDetails } from '@/ui/formatters/details.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { validateDetailsItem } from '@/utils/typeGuards.js';

/**
 * Format details for human-readable output.
 * Dispatches to the appropriate formatter based on type.
 *
 * @param data - Details result containing item and type
 */
function formatDetails(data: DetailsResult): string {
  if (data.type === 'network') {
    return formatNetworkDetails(data.item as NetworkRequest);
  } else {
    return formatConsoleDetails(data.item as ConsoleMessage);
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
    .action(async (type: string, id: string, options: DetailsCommandOptions) => {
      options.type = type as 'network' | 'console';
      options.id = id;

      await runCommand<DetailsCommandOptions, DetailsResult>(
        async (opts) => {
          if (opts.type !== 'network' && opts.type !== 'console') {
            return {
              success: false,
              error: `Unknown type: ${String(opts.type)}. Valid types: network, console`,
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
            };
          }

          const response = await getDetails(opts.type, opts.id);

          validateIPCResponse(response);

          if (!response.data?.item) {
            return {
              success: false,
              error: 'No data in response',
              exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
            };
          }

          const validatedItem = validateDetailsItem(response.data.item, opts.type);

          return {
            success: true,
            data: {
              item: validatedItem,
              type: opts.type,
            },
          };
        },
        options,
        formatDetails
      );
    });
}
