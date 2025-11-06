import type { Command } from 'commander';

import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { callCDP } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/responseValidator.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for the `bdg cdp` command.
 */
interface CdpOptions extends BaseCommandOptions {
  /** CDP method parameters as JSON string */
  params?: string;
}

/**
 * Register CDP command.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerCdpCommand(program: Command): void {
  program
    .command('cdp')
    .description('Execute CDP method directly (low-level API access)')
    .argument('<method>', 'CDP method name (e.g., Network.getCookies, Runtime.evaluate)')
    .option('--params <json>', 'CDP method parameters as JSON')
    .action(async (method: string, options: CdpOptions) => {
      await runCommand(
        async (opts) => {
          // Parse parameters if provided
          let params: Record<string, unknown> | undefined;
          if (opts.params) {
            try {
              params = JSON.parse(opts.params) as Record<string, unknown>;
            } catch (error) {
              return {
                success: false,
                error: `Error parsing --params: ${getErrorMessage(error)}. Parameters must be valid JSON.`,
                exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              };
            }
          }

          // Send CDP call request to daemon
          const response = await callCDP(method, params);

          // Validate IPC response (throws on error)
          validateIPCResponse(response);

          return {
            success: true,
            data: response.data?.result,
          };
        },
        { ...options, json: true } // Always output JSON for CDP commands
      );
    });
}
