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
 * Options as received from Commander for the peek command.
 * These mirror CLI flags and keep raw string values for options that
 * need validation/parsing (like --last).
 */
interface PeekCommandOptions
  extends Pick<PreviewOptions, 'json' | 'network' | 'console' | 'verbose' | 'follow'> {
  last?: string;
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
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting', false)
    .option('-n, --network', 'Show only network requests', false)
    .option('-c, --console', 'Show only console messages', false)
    .option('-f, --follow', 'Watch for updates (like tail -f)', false)
    .option('--last <count>', 'Show last N items (network requests + console messages)', '10')
    .action(async (options: PeekCommandOptions) => {
      let lastN: number;
      try {
        lastN = parsePositiveIntOption('last', options.last, {
          defaultValue: 10,
          min: 1,
          max: 1000,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(EXIT_CODES.INVALID_ARGUMENTS);
      }

      const previewBase: PreviewOptions = {
        json: options.json,
        network: options.network,
        console: options.console,
        last: lastN,
        verbose: options.verbose,
        follow: options.follow,
      };

      const showPreview = async (): Promise<void> => {
        try {
          // Fetch preview data via IPC from daemon
          const response = await getPeek();

          // Validate IPC response (will throw on error)
          try {
            validateIPCResponse(response);
          } catch {
            const errorMsg = response.error ?? 'Unknown error';
            // No active session - use RESOURCE_NOT_FOUND
            const exitCode = errorMsg.includes('No active session')
              ? EXIT_CODES.RESOURCE_NOT_FOUND
              : EXIT_CODES.SESSION_FILE_ERROR;
            const result = handleDaemonConnectionError(errorMsg, {
              json: options.json,
              follow: options.follow,
              retryIntervalMs: 1000,
              exitCode,
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
              follow: options.follow,
              retryIntervalMs: 1000,
              exitCode: EXIT_CODES.SESSION_FILE_ERROR,
            });
            if (result.shouldExit) {
              process.exit(result.exitCode);
            }
            return;
          }

          // Clear screen before rendering to prevent stacked outputs in follow mode
          if (options.follow) {
            console.clear();
          }

          // Add current view timestamp for follow mode to show refresh time
          const previewOptions: PreviewOptions = previewBase.follow
            ? { ...previewBase, viewedAt: new Date() }
            : previewBase;

          console.log(formatPreview(output, previewOptions));
        } catch {
          const result = handleDaemonConnectionError('Daemon not running', {
            json: options.json,
            follow: options.follow,
            retryIntervalMs: 1000,
          });
          if (result.shouldExit) {
            process.exit(result.exitCode);
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
