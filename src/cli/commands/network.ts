import type { Command } from 'commander';

import { callCDP } from '@/ipc/client.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import type { Cookie } from '@/utils/formatters/network.js';
import { formatCookies } from '@/utils/formatters/network.js';

/**
 * Options for the `bdg network getCookies` command.
 */
interface GetCookiesOptions {
  /** Filter cookies by URL */
  url?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Register network commands
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerNetworkCommands(program: Command): void {
  const networkCmd = program.command('network').description('Inspect network state and resources');

  // bdg network getCookies
  networkCmd
    .command('getCookies')
    .description('List cookies from the current page')
    .option('--url <url>', 'Filter cookies by URL')
    .option('--json', 'Output as JSON')
    .action(async (options: GetCookiesOptions) => {
      try {
        // Build CDP method parameters
        const params: Record<string, unknown> = {};
        if (options.url) {
          params['urls'] = [options.url];
        }

        // Call CDP Network.getCookies
        const response = await callCDP('Network.getCookies', params);

        // Handle error response
        if (response.status === 'error') {
          console.error(`Error: ${response.error ?? 'Unknown error'}`);
          process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
        }

        // Extract cookies from CDP response
        const cookies = (response.data?.result as { cookies?: Cookie[] })?.cookies ?? [];

        // Output cookies
        if (options.json) {
          console.log(JSON.stringify(cookies, null, 2));
        } else {
          formatCookies(cookies);
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        if (errorMessage.includes('ENOENT') || errorMessage.includes('ECONNREFUSED')) {
          console.error('Daemon not running. Start it with: bdg <url>');
          process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
        }

        console.error(`Error: ${errorMessage}`);
        process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
      }
    });
}
