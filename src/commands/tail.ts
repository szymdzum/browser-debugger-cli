/**
 * Tail command for continuous session monitoring.
 */

import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { fetchPreviewOutput } from '@/commands/shared/dataFetcher.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
import type { TailCommandOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

function parseOptions(options: TailCommandOptions): { lastN: number; interval: number } {
  const lastRule = positiveIntRule({ min: 1, max: 1000, default: 10 });
  const intervalRule = positiveIntRule({ min: 100, max: 60000, default: 1000 });
  return {
    lastN: lastRule.validate(options.last),
    interval: intervalRule.validate(options.interval),
  };
}

function handleValidationError(error: unknown, json: boolean): never {
  if (error instanceof CommandError) {
    if (json) {
      const errorOptions: { exitCode: number; suggestion?: string } = {
        exitCode: error.exitCode,
      };
      if (error.metadata.suggestion) {
        errorOptions.suggestion = error.metadata.suggestion;
      }
      console.log(JSON.stringify(OutputBuilder.buildJsonError(error.message, errorOptions)));
    } else {
      console.error(error.message);
      if (error.metadata.suggestion) console.error(error.metadata.suggestion);
    }
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT_CODES.INVALID_ARGUMENTS);
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
    .option('--last <count>', 'Show last N items (network requests + console messages)', '10')
    .option('--interval <ms>', 'Update interval in milliseconds', '1000')
    .action(async (options: TailCommandOptions) => {
      let lastN: number;
      let interval: number;

      try {
        const parsed = parseOptions(options);
        lastN = parsed.lastN;
        interval = parsed.interval;
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      const showPreview = async (): Promise<void> => {
        const result = await fetchPreviewOutput();

        if (!result.success) {
          const errorResult = handleDaemonConnectionError(result.error, {
            json: options.json,
            follow: true,
            retryIntervalMs: interval,
            exitCode: result.exitCode,
          });
          if (errorResult.shouldExit) process.exit(errorResult.exitCode);
          return;
        }

        console.clear();
        console.log(formatPreview(result.data, createPreviewOptions(options, lastN)));
      };

      await setupFollowMode(showPreview, {
        startMessage: followingPreviewMessage,
        stopMessage: stoppedFollowingPreviewMessage,
        intervalMs: interval,
        handleEpipe: true,
      });
    });
}
