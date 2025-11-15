import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/responseValidator.js';
import type { BdgOutput } from '@/types.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { handleDaemonConnectionError } from '@/utils/daemonErrors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parsePositiveIntOption } from '@/utils/validation.js';

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
    .action(async (options: PreviewOptions) => {
      const lastN = parsePositiveIntOption('last', options.last, {
        defaultValue: 10,
        min: 1,
        max: 1000,
        exitOnError: true,
      });
      options.last = lastN.toString();

      const showPreview = async (): Promise<void> => {
        try {
          // Fetch preview data via IPC from daemon
          const response = await getPeek();

          // Validate IPC response (will throw on error)
          try {
            validateIPCResponse(response);
          } catch {
            handleDaemonConnectionError(response.error ?? 'Unknown error', {
              json: options.json,
              follow: options.follow,
              retryIntervalMs: 1000,
              exitCode: EXIT_CODES.SESSION_FILE_ERROR,
            });
            return;
          }

          // Extract preview data from response
          const output = response.data?.preview as BdgOutput | undefined;
          if (!output) {
            handleDaemonConnectionError('No preview data in response', {
              json: options.json,
              follow: options.follow,
              retryIntervalMs: 1000,
              exitCode: EXIT_CODES.SESSION_FILE_ERROR,
            });
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
          handleDaemonConnectionError('Daemon not running', {
            json: options.json,
            follow: options.follow,
            retryIntervalMs: 1000,
          });
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
