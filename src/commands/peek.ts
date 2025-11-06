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
 * Handle errors in a consistent way for both follow and one-time modes.
 *
 * @param error - Error message
 * @param options - Preview options
 * @param exitCode - Exit code to use if not in follow mode
 */
function handlePreviewError(error: string, options: PreviewOptions, exitCode: number): void {
  if (options.json) {
    console.log(JSON.stringify(OutputBuilder.buildJsonError(error), null, 2));
  } else {
    console.error(noPreviewDataError());
  }

  if (!options.follow) {
    process.exit(exitCode);
  }
}

/**
 * Register peek command.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerPeekCommand(program: Command): void {
  program
    .command('peek')
    .description('Preview collected data without stopping the session')
    .addOption(jsonOption)
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting')
    .option('-n, --network', 'Show only network requests')
    .option('-c, --console', 'Show only console messages')
    .option('-f, --follow', 'Watch for updates (like tail -f)')
    .option('--last <count>', 'Show last N items', '10')
    .action(async (options: PreviewOptions) => {
      // Validate --last parameter
      const lastN = parseInt(options.last ?? '10', 10);
      if (isNaN(lastN) || lastN < 1 || lastN > 1000) {
        console.error(invalidLastArgumentError(options.last));
        process.exit(EXIT_CODES.INVALID_ARGUMENTS);
      }
      options.last = lastN.toString();

      const showPreview = async (): Promise<void> => {
        try {
          // Fetch preview data via IPC from daemon
          const response = await getPeek();

          // Validate IPC response (will throw on error)
          try {
            validateIPCResponse(response);
          } catch {
            handlePreviewError(
              response.error ?? 'Unknown error',
              options,
              EXIT_CODES.RESOURCE_NOT_FOUND
            );
            return;
          }

          // Extract preview data from response
          const output = response.data?.preview as BdgOutput | undefined;
          if (!output) {
            handlePreviewError(
              'No preview data in response',
              options,
              EXIT_CODES.RESOURCE_NOT_FOUND
            );
            return;
          }

          // Clear screen before rendering to prevent stacked outputs in follow mode
          if (options.follow) {
            console.clear();
          }

          // Add current view timestamp for follow mode to show refresh time
          const previewOptions: PreviewOptions = options.follow
            ? { ...options, viewedAt: new Date() }
            : options;

          console.log(formatPreview(output, previewOptions));
        } catch {
          // Handle IPC connection errors (daemon not running, etc.)
          // Note: validateIPCResponse errors are caught above
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

          if (!options.follow) {
            process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
          }
        }
      };

      if (options.follow) {
        // Follow mode: update every second
        console.error(followingPreviewMessage());
        await showPreview();
        const followInterval = setInterval(() => {
          void showPreview();
        }, 1000);

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
          clearInterval(followInterval);
          console.error(stoppedFollowingPreviewMessage());
          process.exit(EXIT_CODES.SUCCESS);
        });
      } else {
        // One-time preview
        await showPreview();
      }
    });
}
