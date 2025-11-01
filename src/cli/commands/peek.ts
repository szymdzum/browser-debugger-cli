import { Command } from 'commander';

import { formatPreview, formatNoPreviewDataMessage } from '@/cli/formatters/previewFormatter.js';
import { readPartialOutput } from '@/utils/session.js';

/**
 * Register peek command
 */
export function registerPeekCommand(program: Command) {
  program
    .command('peek')
    .description('Preview collected data without stopping the session')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting')
    .option('-n, --network', 'Show only network requests')
    .option('-c, --console', 'Show only console messages')
    .option('-f, --follow', 'Watch for updates (like tail -f)')
    .option('--last <count>', 'Show last N items', '10')
    .action(async (options) => {
      const showPreview = () => {
        const output = readPartialOutput();

        if (!output) {
          console.error(formatNoPreviewDataMessage());
          if (!options.follow) {
            process.exit(1);
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
          process.exit(0);
        });
      } else {
        // One-time preview
        showPreview();
      }
    });
}
