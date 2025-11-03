import type { Command } from 'commander';

import {
  formatPreview,
  formatNoPreviewDataMessage,
  type PreviewOptions,
} from '@/cli/formatters/previewFormatter.js';
import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { getPeek } from '@/ipc/client.js';
import type { BdgOutput } from '@/types.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Register peek command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerPeekCommand(program: Command): void {
  program
    .command('peek')
    .description('Preview collected data without stopping the session')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting')
    .option('-n, --network', 'Show only network requests')
    .option('-c, --console', 'Show only console messages')
    .option('-f, --follow', 'Watch for updates (like tail -f)')
    .option('--last <count>', 'Show last N items', '10')
    .action(async (options: PreviewOptions) => {
      const showPreview = async (): Promise<void> => {
        try {
          // Fetch preview data via IPC from daemon
          const response = await getPeek();

          if (response.status === 'error') {
            if (options.json) {
              console.log(
                JSON.stringify(
                  OutputBuilder.buildJsonError(response.error ?? 'Unknown error', {
                    note: 'Session may not be running or data not yet written',
                    suggestions: ['Check session status: bdg status', 'Start a session: bdg <url>'],
                  }),
                  null,
                  2
                )
              );
            } else {
              console.error(formatNoPreviewDataMessage());
            }
            if (!options.follow) {
              process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
            }
            return;
          }

          // Extract preview data from response (cast to BdgOutput for compatibility)
          const output = response.data?.preview as BdgOutput | undefined;
          if (!output) {
            if (options.json) {
              console.log(
                JSON.stringify(
                  OutputBuilder.buildJsonError('No preview data in response', {
                    note: 'Session may be starting up',
                    suggestions: [
                      'Wait a moment and try again',
                      'Check session status: bdg status',
                    ],
                  }),
                  null,
                  2
                )
              );
            } else {
              console.error(formatNoPreviewDataMessage());
            }
            if (!options.follow) {
              process.exit(EXIT_CODES.RESOURCE_NOT_FOUND);
            }
            return;
          }

          if (!options.follow) {
            console.clear();
          }

          console.log(formatPreview(output, options));
        } catch (error) {
          // Handle IPC errors (daemon not running, connection issues, etc.)
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(`Failed to connect to daemon: ${errorMessage}`, {
                  note: 'Daemon may not be running',
                  suggestions: [
                    'Ensure a session is running: bdg <url>',
                    'Check daemon status: bdg status',
                  ],
                }),
                null,
                2
              )
            );
          } else {
            console.error(`Error: ${errorMessage}`);
            console.error('\nDaemon may not be running. Try starting a session first: bdg <url>');
          }

          if (!options.follow) {
            process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
          }
        }
      };

      if (options.follow) {
        // Follow mode: update every second
        console.error('Following live preview (Ctrl+C to stop)...\n');
        await showPreview();
        const followInterval = setInterval(() => {
          void showPreview();
        }, 1000);

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
          clearInterval(followInterval);
          console.error('\nStopped following preview');
          process.exit(EXIT_CODES.SUCCESS);
        });
      } else {
        // One-time preview
        await showPreview();
      }
    });
}
