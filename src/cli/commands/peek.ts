import type { Command } from 'commander';

import {
  formatPreview,
  formatNoPreviewDataMessage,
  type PreviewOptions,
} from '@/cli/formatters/previewFormatter.js';
import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { readPartialOutput } from '@/utils/session.js';

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
    .action((options: PreviewOptions) => {
      const showPreview = (): void => {
        const output = readPartialOutput();

        if (!output) {
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError('No preview data available', {
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

        if (!options.follow) {
          console.clear();
        }

        console.log(formatPreview(output, options));
      };

      if (options.follow) {
        // Follow mode: update every second
        console.error('Following live preview (Ctrl+C to stop)...\n');
        showPreview();
        const followInterval = setInterval(() => {
          showPreview();
        }, 1000);

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
          clearInterval(followInterval);
          console.error('\nStopped following preview');
          process.exit(EXIT_CODES.SUCCESS);
        });
      } else {
        // One-time preview
        showPreview();
      }
    });
}
