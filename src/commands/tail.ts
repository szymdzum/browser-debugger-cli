import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { BdgOutput } from '@/types.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { handleDaemonConnectionError } from '@/utils/daemonErrors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parsePositiveIntOption } from '@/utils/validation.js';

/**
 * Options as received from Commander for the tail command.
 * These mirror CLI flags and keep raw string values for options that
 * need validation/parsing (like --last and --interval).
 */
interface TailCommandOptions
  extends Pick<PreviewOptions, 'json' | 'network' | 'console' | 'verbose'> {
  last?: string;
  /** Update interval in milliseconds */
  interval?: string;
}

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
      let lastN: number;
      let interval: number;
      try {
        lastN = parsePositiveIntOption('last', options.last, {
          defaultValue: 10,
          min: 1,
          max: 1000,
        });

        interval = parsePositiveIntOption('interval', options.interval, {
          defaultValue: 1000,
          min: 100,
          max: 60000,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(EXIT_CODES.INVALID_ARGUMENTS);
      }

      /**
       * Fetch and display preview data.
       */
      const showPreview = async (): Promise<void> => {
        try {
          // Fetch preview data via IPC from daemon
          const response = await getPeek();

          // Validate IPC response (will throw on error)
          try {
            validateIPCResponse(response);
          } catch {
            const result = handleDaemonConnectionError(response.error ?? 'Unknown error', {
              json: options.json,
              follow: true,
              retryIntervalMs: interval,
              exitCode: EXIT_CODES.SESSION_FILE_ERROR,
            });
            if (result.shouldExit) {
              process.exit(result.exitCode);
            }
            return;
          }

          // Extract preview data from response
          const output = response.data?.preview as BdgOutput | undefined;
          if (!output) {
            const result = handleDaemonConnectionError('No preview data in response', {
              json: options.json,
              follow: true,
              retryIntervalMs: interval,
              exitCode: EXIT_CODES.SESSION_FILE_ERROR,
            });
            if (result.shouldExit) {
              process.exit(result.exitCode);
            }
            return;
          }

          // Clear screen before rendering to prevent stacked outputs
          console.clear();

          // Add current view timestamp to show refresh time
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
        } catch {
          const result = handleDaemonConnectionError('Daemon not running', {
            json: options.json,
            follow: true,
            retryIntervalMs: interval,
          });
          if (result.shouldExit) {
            process.exit(result.exitCode);
          }
        }
      };

      // Start continuous monitoring
      console.error(followingPreviewMessage());
      await showPreview();

      const followInterval = setInterval(() => {
        void showPreview();
      }, interval);

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        clearInterval(followInterval);
        console.error(stoppedFollowingPreviewMessage());
        process.exit(EXIT_CODES.SUCCESS);
      });
    });
}
