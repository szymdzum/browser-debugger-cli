import type { Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import type { PeekCommandOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import { getErrorMessage } from '@/connection/errors.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { filterByResourceType } from '@/telemetry/filters.js';
import type { BdgOutput } from '@/types.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { getExitCodeForConnectionError } from '@/utils/errorMapping.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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
    .option('--last <count>', 'Show last N items (default: 10)', '10')
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
          } catch (validationError) {
            const errorMsg = getErrorMessage(validationError);
            const exitCode = getExitCodeForConnectionError(errorMsg);
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

          const unfilteredNetworkCount = output.data.network?.length ?? 0;
          const filteredNetwork = output.data.network
            ? filterByResourceType(output.data.network, resourceTypes)
            : undefined;

          const previewOptions: PreviewOptions = {
            ...previewBase,
            ...(previewBase.follow && { viewedAt: new Date() }),
            ...(resourceTypes.length > 0 && {
              filteredTypes: resourceTypes,
              unfilteredNetworkCount,
            }),
          };

          const filteredOutput: BdgOutput = {
            ...output,
            data: {
              ...output.data,
              ...(filteredNetwork !== undefined && { network: filteredNetwork }),
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
