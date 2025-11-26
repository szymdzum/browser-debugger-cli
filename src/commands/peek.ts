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
import type { PeekCommandOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { filterByResourceType } from '@/telemetry/filters.js';
import type { BdgOutput } from '@/types.js';
import { OutputBuilder } from '@/ui/OutputBuilder.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatPreview, type PreviewOptions } from '@/ui/formatters/preview.js';
import { followingPreviewMessage, stoppedFollowingPreviewMessage } from '@/ui/messages/preview.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface ProcessedPreview {
  output: BdgOutput;
  unfilteredNetworkCount: number;
}

interface ParsedOptions {
  lastN: number;
  resourceTypes: Protocol.Network.ResourceType[];
}

function parseOptions(options: PeekCommandOptions): ParsedOptions {
  const lastN = positiveIntRule({ min: 1, max: 1000, default: 10 }).validate(options.last);
  const resourceTypes = resourceTypeRule().validate(options.type);
  return { lastN, resourceTypes };
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

async function fetchAndFilterPreview(
  lastN: number,
  resourceTypes: Protocol.Network.ResourceType[]
): Promise<FetchResult<ProcessedPreview>> {
  const result = await fetchPreviewOutput(lastN);
  if (!result.success) return result;

  const output = result.data;
  const unfilteredNetworkCount = output.data.network?.length ?? 0;

  if (resourceTypes.length === 0) {
    return { success: true, data: { output, unfilteredNetworkCount } };
  }

  const filteredNetwork = output.data.network
    ? filterByResourceType(output.data.network, resourceTypes)
    : undefined;

  const filteredOutput: BdgOutput = {
    ...output,
    data: { ...output.data, ...(filteredNetwork && { network: filteredNetwork }) },
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
    const result = await fetchAndFilterPreview(lastN, resourceTypes);

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

    console.clear();
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
    .option('-d, --dom', 'Show DOM/A11y tree data', false)
    .option('-f, --follow', 'Watch for updates (like tail -f)', false)
    .option('--last <count>', 'Show last N items (default: 10)', '10')
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
        dom: options.dom,
        last: lastN,
        verbose: options.verbose,
        follow: options.follow,
      };

      if (options.follow) {
        await runFollowMode(options, lastN, resourceTypes, baseOptions);
        return;
      }

      await runCommand(
        async () => {
          const result = await fetchAndFilterPreview(lastN, resourceTypes);
          if (!result.success) {
            return createErrorResult(result.error, result.exitCode);
          }
          return { success: true, data: result.data.output };
        },
        options,
        (output: BdgOutput) => {
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
