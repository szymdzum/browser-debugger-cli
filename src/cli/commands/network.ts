import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/cli/handlers/CommandRunner.js';
import { runCommand } from '@/cli/handlers/CommandRunner.js';
import { jsonOption } from '@/cli/handlers/commonOptions.js';
import { callCDP } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/responseValidator.js';
import type { Cookie } from '@/utils/formatters/network.js';
import { formatCookies } from '@/utils/formatters/network.js';

/**
 * Options for the `bdg network getCookies` command.
 */
interface GetCookiesOptions extends BaseCommandOptions {
  /** Filter cookies by URL */
  url?: string;
}

/**
 * Register network commands.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerNetworkCommands(program: Command): void {
  const networkCmd = program.command('network').description('Inspect network state and resources');

  // bdg network getCookies
  networkCmd
    .command('getCookies')
    .description('List cookies from the current page')
    .option('--url <url>', 'Filter cookies by URL')
    .addOption(jsonOption)
    .action(async (options: GetCookiesOptions) => {
      await runCommand(
        async (opts) => {
          // Build CDP method parameters
          const params: Record<string, unknown> = {};
          if (opts.url) {
            params['urls'] = [opts.url];
          }

          // Call CDP Network.getCookies
          const response = await callCDP('Network.getCookies', params);

          // Validate IPC response (throws on error)
          validateIPCResponse(response);

          // Extract cookies from CDP response
          const cookies = (response.data?.result as { cookies?: Cookie[] })?.cookies ?? [];

          return {
            success: true,
            data: cookies,
          };
        },
        options,
        formatCookies // Human-readable formatter
      );
    });
}
