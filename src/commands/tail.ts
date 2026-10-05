/**
 * Tail command for continuous session monitoring.
 */

import type { Command } from 'commander';

import { jsonOption, showBothSectionsWhenBothRequested } from '@/commands/shared/commonOptions.js';
import { noteFollowConnected } from '@/commands/shared/daemonErrorHandler.js';
import { fetchPreviewOutput } from '@/commands/shared/dataFetcher.js';
import {
  followFetchFailure,
  setupFollowMode,
  type FollowPoll,
} from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { TailCommandOptions } from '@/commands/shared/optionTypes.js';
import { MAX_LAST_ITEMS, positiveIntRule } from '@/commands/shared/validation.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';

function parseOptions(options: TailCommandOptions): { lastN: number; interval: number } {
  const lastRule = positiveIntRule({
    name: '--last',
    min: 1,
    max: MAX_LAST_ITEMS,
    default: 10,
    allowZeroForAll: true,
  });
  const intervalRule = positiveIntRule({ name: '--interval', min: 100, max: 60000, default: 1000 });
  return {
    lastN: lastRule.validate(options.last),
    interval: intervalRule.validate(options.interval),
  };
}

function createPreviewOptions(options: TailCommandOptions, lastN: number): PreviewOptions {
  return {
    json: options.json,
    network: options.network,
    console: options.console,
    last: lastN,
    verbose: options.verbose,
    follow: true,
    viewedAt: new Date(),
  };
}

export function registerTailCommand(program: Command): void {
  program
    .command('tail')
    .description('Continuously monitor session data (like tail -f)')
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
      showBothSectionsWhenBothRequested(options);
      let lastN: number;
      let interval: number;

      try {
        const parsed = parseOptions(options);
        lastN = parsed.lastN;
        interval = parsed.interval;
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      const showPreview = async (): Promise<FollowPoll> => {
        const result = await fetchPreviewOutput({ lastN });

        if (!result.success) {
          return followFetchFailure(result, { json: options.json, retryIntervalMs: interval });
        }
        noteFollowConnected();

        if (!options.json) console.clear();
        console.log(formatPreview(result.data, createPreviewOptions(options, lastN)));
        return undefined;
      };

      await setupFollowMode(showPreview, {
        startMessage: followingPreviewMessage,
        stopMessage: stoppedFollowingPreviewMessage,
        intervalMs: interval,
      });
    });
}
