/**
 * `bdg tail`: deprecated alias of `bdg peek --follow` (#115). It keeps its
 * options and says to use `peek --follow` instead.
 */

import type { Command } from 'commander';

import { followPreview } from '@/commands/peek.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { TailCommandOptions } from '@/commands/shared/optionTypes.js';
import { tailDeprecatedNotice } from '@/ui/messages/preview.js';

/**
 * Register the deprecated `tail` command.
 *
 * @param program - Root command
 */
export function registerTailCommand(program: Command): void {
  program
    .command('tail')
    .description('Deprecated: use "bdg peek --follow" (same options)')
    .addOption(jsonOption())
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting', false)
    .option('-n, --network', 'Show only network requests', false)
    .option('-c, --console', 'Show only console messages', false)
    .option(
      '--last <count>',
      'Show last N items (network requests + console messages), 0 for all',
      '10'
    )
    .option('--interval <ms>', 'Update interval in milliseconds', '1000')
    .action(async (options: TailCommandOptions) => {
      console.error(tailDeprecatedNotice());
      await followPreview({ ...options, follow: true });
    });
}
