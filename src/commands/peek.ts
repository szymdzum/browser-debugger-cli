/**
 * Peek command for previewing collected session data.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import {
  fetchPreviewOutput,
  createErrorResult,
  type FetchResult,
} from '@/commands/shared/dataFetcher.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { PeekCommandOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { PeekSection } from '@/ipc/protocol/commands.js';
import { filterByResourceType } from '@/telemetry/filters.js';
import type { BdgOutput } from '@/types.js';
import {
  buildPreviewJsonData,
  formatPreview,
  type PreviewJsonData,
  type PreviewOptions,
} from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';

interface ProcessedPreview {
  output: BdgOutput;
  unfilteredNetworkCount: number;
}

interface ParsedOptions {
  lastN: number;
  resourceTypes: Protocol.Network.ResourceType[];
}

function parseOptions(options: PeekCommandOptions): ParsedOptions {
  const lastN = positiveIntRule({
    name: '--last',
    min: 1,
    max: 1000,
    default: 10,
    allowZeroForAll: true,
  }).validate(options.last);
  const resourceTypes = resourceTypeRule().validate(options.type);
  return { lastN, resourceTypes };
}

/**
 * Data section selected by `--network` / `--console`, if any.
 *
 * @param options - Peek options
 * @returns Section to fetch, or undefined for both
 */
function peekSection(options: PeekCommandOptions): PeekSection | undefined {
  if (options.network) return 'network';
  return options.console ? 'console' : undefined;
}

/**
 * Fetch the preview, filtering network requests by resource type first.
 *
 * With a type filter all requests are fetched and filtered before the
 * `--last` window is applied, so older matches are not hidden by newer
 * requests of other types.
 *
 * @param lastN - Items to show (0 = all)
 * @param resourceTypes - Resource types to keep (empty = all)
 * @param only - Fetch only network or only console data
 * @returns Preview with filtered network data and the unfiltered request count
 */
async function fetchAndFilterPreview(
  lastN: number,
  resourceTypes: Protocol.Network.ResourceType[],
  only?: PeekSection
): Promise<FetchResult<ProcessedPreview>> {
  const result = await fetchPreviewOutput(resourceTypes.length > 0 ? 0 : lastN, only);
  if (!result.success) return result;

  const output = result.data;
  const unfilteredNetworkCount = output.totals?.network ?? output.data.network?.length ?? 0;
  if (resourceTypes.length === 0 || !output.data.network) {
    return { success: true, data: { output, unfilteredNetworkCount } };
  }

  const network = filterByResourceType(output.data.network, resourceTypes);
  const filteredOutput: BdgOutput = {
    ...output,
    data: { ...output.data, network },
    ...(output.totals && { totals: { ...output.totals, network: network.length } }),
  };
  return { success: true, data: { output: filteredOutput, unfilteredNetworkCount } };
}

function createPreviewOptions(
  base: PreviewOptions,
  resourceTypes: Protocol.Network.ResourceType[],
  unfilteredCount: number
): PreviewOptions {
  const options = { ...base };
  if (base.follow) options.viewedAt = new Date();
  if (resourceTypes.length > 0) {
    options.filteredTypes = resourceTypes;
    options.unfilteredNetworkCount = unfilteredCount;
  }
  return options;
}

async function runFollowMode(
  options: PeekCommandOptions,
  lastN: number,
  resourceTypes: Protocol.Network.ResourceType[],
  baseOptions: PreviewOptions
): Promise<void> {
  const showPreview = async (): Promise<void> => {
    const result = await fetchAndFilterPreview(lastN, resourceTypes, peekSection(options));

    if (!result.success) {
      const errorResult = handleDaemonConnectionError(result.error, {
        json: options.json,
        follow: true,
        retryIntervalMs: 1000,
        exitCode: result.exitCode,
      });
      if (errorResult.shouldExit) process.exit(errorResult.exitCode);
      return;
    }

    if (!options.json) console.clear();
    const previewOptions = createPreviewOptions(
      baseOptions,
      resourceTypes,
      result.data.unfilteredNetworkCount
    );
    console.log(formatPreview(result.data.output, previewOptions));
  };

  await setupFollowMode(showPreview, {
    startMessage: followingPreviewMessage,
    stopMessage: stoppedFollowingPreviewMessage,
    intervalMs: 1000,
  });
}

export function registerPeekCommand(program: Command): void {
  program
    .command('peek')
    .description('Preview collected data without stopping the session')
    .addOption(jsonOption())
    .option('-v, --verbose', 'Use verbose output with full URLs and formatting', false)
    .option('-n, --network', 'Show only network requests', false)
    .option('-c, --console', 'Show only console messages', false)
    .option('-f, --follow', 'Watch for updates (like tail -f)', false)
    .option('--last <count>', 'Show last N items, 0 for all (default: 10)', '10')
    .option(
      '--type <types>',
      'Filter network requests by resource type (comma-separated: Document,XHR,Fetch,etc.)'
    )
    .action(async (options: PeekCommandOptions) => {
      if (options.network && !options.json) {
        console.error(
          'Note: "bdg peek --network" is deprecated. Use "bdg network list" for enhanced filtering.'
        );
      }

      let lastN: number;
      let resourceTypes: Protocol.Network.ResourceType[];

      try {
        const parsed = parseOptions(options);
        lastN = parsed.lastN;
        resourceTypes = parsed.resourceTypes;
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      const baseOptions: PreviewOptions = {
        json: options.json,
        network: options.network,
        console: options.console,
        last: lastN,
        verbose: options.verbose,
        follow: options.follow,
      };

      if (options.follow) {
        await runFollowMode(options, lastN, resourceTypes, baseOptions);
        return;
      }

      await runCommand<PeekCommandOptions, BdgOutput | PreviewJsonData>(
        async () => {
          const result = await fetchAndFilterPreview(lastN, resourceTypes, peekSection(options));
          if (!result.success) {
            return createErrorResult(result.error, result.exitCode);
          }
          const { output } = result.data;
          return {
            success: true,
            data: options.json ? buildPreviewJsonData(output, baseOptions) : output,
          };
        },
        options,
        (data) => {
          const output = data as BdgOutput;
          const previewOptions = createPreviewOptions(
            baseOptions,
            resourceTypes,
            output.data.network?.length ?? 0
          );
          return formatPreview(output, previewOptions);
        }
      );
    });
}
