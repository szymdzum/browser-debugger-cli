import type { Command } from 'commander';

import { callCDP } from '@/ipc/client.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for the `bdg cdp` command.
 */
interface CdpOptions {
  /** CDP method parameters as JSON string */
  params?: string;
}

/**
 * Register CDP command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerCdpCommand(program: Command): void {
  program
    .command('cdp')
    .description('Execute CDP method directly (low-level API access)')
    .argument('<method>', 'CDP method name (e.g., Network.getCookies, Runtime.evaluate)')
    .option('--params <json>', 'CDP method parameters as JSON')
    .action(async (method: string, options: CdpOptions) => {
      try {
        // Parse parameters if provided
        let params: Record<string, unknown> | undefined;
        if (options.params) {
          try {
            params = JSON.parse(options.params) as Record<string, unknown>;
          } catch (error) {
            console.error(`Error parsing --params: ${getErrorMessage(error)}`);
            console.error('Parameters must be valid JSON');
            process.exit(EXIT_CODES.INVALID_ARGUMENTS);
          }
        }

        // Send CDP call request to daemon
        const response = await callCDP(method, params);

        // Handle error response
        if (response.status === 'error') {
          console.error(`Error: ${response.error ?? 'Unknown error'}`);
          process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
        }

        // Output result as JSON
        console.log(JSON.stringify(response.data?.result, null, 2));
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
