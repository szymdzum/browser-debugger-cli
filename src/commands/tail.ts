import type { Command } from 'commander';

import { OutputBuilder } from '@/commands/shared/OutputBuilder.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/responseValidator.js';
import type { BdgOutput } from '@/types.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { invalidLastArgumentError } from '@/ui/messages/commands.js';
import { daemonNotRunningError, noPreviewDataError } from '@/ui/messages/errors.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for tail command (extends PreviewOptions).
 */
interface TailOptions extends PreviewOptions {
  /** Update interval in milliseconds */
  interval?: string;
}

/**
 * Handle errors during tail operation.
 *
 * @param error - Error message
 * @param options - Tail options
 */
function handleTailError(error: string, options: TailOptions): void {
  const timestamp = new Date().toISOString();

  if (options.json) {
    console.log(
      JSON.stringify(
        OutputBuilder.buildJsonError(error, { exitCode: EXIT_CODES.RESOURCE_NOT_FOUND }),
        null,
        2
      )
    );
  } else {
    console.error(noPreviewDataError());
  }

  // Don't exit in tail mode - show retry message and keep trying
  console.error(
    `\n[${timestamp}] ⚠️  Connection lost, retrying every ${options.interval ?? '1000'}ms...`
  );
  console.error('Press Ctrl+C to stop');
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
    .action(async (options: TailOptions) => {
      // Validate --last parameter
      const lastN = parseInt(options.last ?? '10', 10);
      if (isNaN(lastN) || lastN < 1 || lastN > 1000) {
        console.error(invalidLastArgumentError(options.last));
        process.exit(EXIT_CODES.INVALID_ARGUMENTS);
      }
      options.last = lastN.toString();

      // Validate --interval parameter
      const interval = parseInt(options.interval ?? '1000', 10);
      if (isNaN(interval) || interval < 100 || interval > 60000) {
        console.error('Error: --interval must be between 100 and 60000 milliseconds');
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
            handleTailError(response.error ?? 'Unknown error', options);
            return;
          }

          // Extract preview data from response
          const output = response.data?.preview as BdgOutput | undefined;
          if (!output) {
            handleTailError('No preview data in response', options);
            return;
          }

          // Clear screen before rendering to prevent stacked outputs
          console.clear();

          // Add current view timestamp to show refresh time
          const previewOptions: PreviewOptions = {
            ...options,
            viewedAt: new Date(),
          };

          console.log(formatPreview(output, previewOptions));
        } catch {
          // Handle IPC connection errors (daemon not running, etc.)
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError('Daemon not running', {
                  suggestion: 'Start it with: bdg <url>',
                }),
                null,
                2
              )
            );
          } else {
            console.error(daemonNotRunningError());
          }
          // Don't exit - keep trying in case daemon starts
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
