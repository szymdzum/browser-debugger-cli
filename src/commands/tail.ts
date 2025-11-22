import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import type { TailCommandOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { getErrorMessage } from '@/connection/errors.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { BdgOutput } from '@/types.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Register tail command for continuous monitoring.
 *
 * Tail command is like `tail -f` for bdg session data.
 * It continuously polls and displays updates from the running session.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerTailCommand(program: Command): void {
  program
    .command('tail')
    .description('Continuously monitor session data (like tail -f)')
    .addOption(jsonOption)
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting', false)
    .option('-n, --network', 'Show only network requests', false)
    .option('-c, --console', 'Show only console messages', false)
    .option('--last <count>', 'Show last N items (network requests + console messages)', '10')
    .option('--interval <ms>', 'Update interval in milliseconds', '1000')
    .action(async (options: TailCommandOptions) => {
      const lastRule = positiveIntRule({ min: 1, max: 1000, default: 10 });
      const intervalRule = positiveIntRule({ min: 100, max: 60000, default: 1000 });

      let lastN: number;
      let interval: number;
      try {
        lastN = lastRule.validate(options.last);
        interval = intervalRule.validate(options.interval);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(EXIT_CODES.INVALID_ARGUMENTS);
      }

      /**
       * Handle daemon connection or response errors.
       * Returns true if the error was handled and execution should stop.
       */
      const handleError = (errorMessage: string, exitCode?: number): boolean => {
        const result = handleDaemonConnectionError(errorMessage, {
          json: options.json,
          follow: true,
          retryIntervalMs: interval,
          exitCode,
        });
        if (result.shouldExit) {
          process.exit(result.exitCode);
        }
        return true;
      };

      /**
       * Fetch and display preview data.
       */
      const showPreview = async (): Promise<void> => {
        let response;
        try {
          response = await getPeek();
        } catch {
          handleError('Daemon not running');
          return;
        }

        try {
          validateIPCResponse(response);
        } catch (validationError) {
          handleError(getErrorMessage(validationError), EXIT_CODES.SESSION_FILE_ERROR);
          return;
        }

        const output = response.data?.preview as BdgOutput | undefined;
        if (!output) {
          handleError('No preview data in response', EXIT_CODES.SESSION_FILE_ERROR);
          return;
        }

        console.clear();

        const previewOptions: PreviewOptions = {
          json: options.json,
          network: options.network,
          console: options.console,
          last: lastN,
          verbose: options.verbose,
          follow: true,
          viewedAt: new Date(),
        };

        console.log(formatPreview(output, previewOptions));
      };

      console.error(followingPreviewMessage());
      await showPreview();

      const followInterval = setInterval(() => {
        void showPreview();
      }, interval);

      process.on('SIGINT', () => {
        clearInterval(followInterval);
        console.error(stoppedFollowingPreviewMessage());
        process.exit(EXIT_CODES.SUCCESS);
      });

      process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') {
          clearInterval(followInterval);
          process.exit(EXIT_CODES.SUCCESS);
        }
      });
    });
}
