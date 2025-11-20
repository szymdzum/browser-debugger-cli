import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { filterByResourceType } from '@/telemetry/filters.js';
import type { BdgOutput } from '@/types.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options as received from Commander for the peek command.
 * These mirror CLI flags and keep raw string values for options that
 * need validation/parsing (like --last).
 */
interface PeekCommandOptions
  extends Pick<PreviewOptions, 'json' | 'network' | 'console' | 'dom' | 'verbose' | 'follow'> {
  last?: string;
  type?: string;
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
    .option('-d, --dom', 'Show DOM/A11y tree data', false)
    .option('-f, --follow', 'Watch for updates (like tail -f)', false)
    .option('--last <count>', 'Show last N items (network requests + console messages)', '10')
    .option(
      '--type <types>',
      'Filter network requests by resource type (comma-separated: Document,XHR,Fetch,etc.)'
    )
    .action(async (options: PeekCommandOptions) => {
      const lastRule = positiveIntRule({ min: 1, max: 1000, default: 10 });
      const lastN = lastRule.validate(options.last);

      const typeRule = resourceTypeRule();
      const resourceTypes = typeRule.validate(options.type);

      const previewBase: PreviewOptions = {
        json: options.json,
        network: options.network,
        console: options.console,
        dom: options.dom,
        last: lastN,
        verbose: options.verbose,
        follow: options.follow,
      };

      const showPreview = async (): Promise<void> => {
        try {
          const response = await getPeek();

          try {
            validateIPCResponse(response);
          } catch {
            const errorMsg = response.error ?? 'Unknown error';
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

          if (options.follow) {
            console.clear();
          }

          const previewOptions: PreviewOptions = previewBase.follow
            ? { ...previewBase, viewedAt: new Date() }
            : previewBase;

          const filteredOutput: BdgOutput = {
            ...output,
            data: {
              ...output.data,
              ...(output.data.network && {
                network: filterByResourceType(output.data.network, resourceTypes),
              }),
            },
          };

          console.log(formatPreview(filteredOutput, previewOptions));
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
        console.error(followingPreviewMessage());
        await showPreview();
        const followInterval = setInterval(() => {
          void showPreview();
        }, 1000);

        process.on('SIGINT', () => {
          clearInterval(followInterval);
          console.error(stoppedFollowingPreviewMessage());
          process.exit(EXIT_CODES.SUCCESS);
        });
      } else {
        await showPreview();
      }
    });
}
