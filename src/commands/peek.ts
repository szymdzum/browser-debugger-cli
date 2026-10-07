/**
 * Peek command for previewing collected session data.
 */

import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption, showBothSectionsWhenBothRequested } from '@/commands/shared/commonOptions.js';
import { noteFollowConnected } from '@/commands/shared/daemonErrorHandler.js';
import {
  fetchPreviewOutput,
  createErrorResult,
  type FetchResult,
} from '@/commands/shared/dataFetcher.js';
import {
  followFetchFailure,
  setupFollowMode,
  type FollowPoll,
} from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { PeekCommandOptions } from '@/commands/shared/optionTypes.js';
import { MAX_LAST_ITEMS, positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { MAX_CONSOLE_JSON_TEXT_LENGTH, MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { intervalWithoutFollowError } from '@/errors/messages.js';
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
import { EXIT_CODES } from '@/utils/exitCodes.js';

interface ProcessedPreview {
  output: BdgOutput;
  unfilteredNetworkCount: number;
}

interface ParsedOptions {
  lastN: number;
  resourceTypes: Protocol.Network.ResourceType[];
  /** Refresh interval of --follow (ms) */
  interval: number;
}

function parseOptions(options: PeekCommandOptions): ParsedOptions {
  const lastN = positiveIntRule({
    name: '--last',
    min: 1,
    max: MAX_LAST_ITEMS,
    default: 10,
    allowZeroForAll: true,
  }).validate(options.last);
  const resourceTypes = resourceTypeRule().validate(options.type);
  if (options.interval !== undefined && !options.follow) {
    const err = intervalWithoutFollowError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const interval = positiveIntRule({
    name: '--interval',
    min: 100,
    max: 60000,
    default: 1000,
  }).validate(options.interval);
  return { lastN, resourceTypes, interval };
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
  const result = await fetchPreviewOutput({
    lastN: resourceTypes.length > 0 ? 0 : lastN,
    ...(only && { only }),
  });
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
  parsed: ParsedOptions,
  baseOptions: PreviewOptions
): Promise<void> {
  const { lastN, resourceTypes, interval } = parsed;
  const showPreview = async (): Promise<FollowPoll> => {
    const result = await fetchAndFilterPreview(lastN, resourceTypes, peekSection(options));

    if (!result.success) {
      return followFetchFailure(result, { json: options.json, retryIntervalMs: interval });
    }
    noteFollowConnected();

    if (!options.json) console.clear();
    const previewOptions = createPreviewOptions(
      baseOptions,
      resourceTypes,
      result.data.unfilteredNetworkCount
    );
    console.log(formatPreview(result.data.output, previewOptions));
    return undefined;
  };

  await setupFollowMode(showPreview, {
    startMessage: followingPreviewMessage,
    stopMessage: stoppedFollowingPreviewMessage,
    intervalMs: interval,
  });
}

/**
 * Parse the options, reporting an invalid one and exiting.
 *
 * @param options - Peek options
 * @returns Parsed options
 */
function parsePeekOptions(options: PeekCommandOptions): ParsedOptions {
  try {
    return parseOptions(options);
  } catch (error) {
    handleValidationError(error, options.json ?? false);
  }
}

/**
 * How the preview is shown.
 *
 * @param options - Peek options
 * @param lastN - Items to show
 * @returns Preview options
 */
function previewDisplayOptions(options: PeekCommandOptions, lastN: number): PreviewOptions {
  return {
    json: options.json,
    network: options.network,
    console: options.console,
    last: lastN,
    verbose: options.verbose,
    follow: options.follow,
    full: options.full,
  };
}

/**
 * Watch the session data (`peek --follow`, and the deprecated `tail`).
 *
 * @param options - Peek options (follow implied)
 */
export async function followPreview(options: PeekCommandOptions): Promise<void> {
  const following = { ...options, follow: true };
  showBothSectionsWhenBothRequested(following);
  const parsed = parsePeekOptions(following);
  await runFollowMode(following, parsed, previewDisplayOptions(following, parsed.lastN));
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
    .option('--interval <ms>', 'Refresh interval of --follow in ms, 100-60000 (default: 1000)')
    .option('--last <count>', 'Show last N items, 0 for all', '10')
    .option(
      '--type <types>',
      'Filter network requests by resource type (comma-separated: Document,XHR,Fetch,etc.)'
    )
    .option(
      '--full',
      `Print console message texts whole (default: the first ${MAX_CONSOLE_TEXT_LENGTH} characters, ${MAX_CONSOLE_JSON_TEXT_LENGTH} in JSON)`,
      false
    )
    .action(async (options: PeekCommandOptions) => {
      showBothSectionsWhenBothRequested(options);
      if (options.network && !options.json) {
        console.error(
          'Note: "bdg peek --network" is deprecated. Use "bdg network list" for enhanced filtering.'
        );
      }
      const parsed = parsePeekOptions(options);
      const { lastN, resourceTypes } = parsed;
      const baseOptions = previewDisplayOptions(options, lastN);

      if (options.follow) {
        await runFollowMode(options, parsed, baseOptions);
        return;
      }

      await runCommand<PeekCommandOptions, BdgOutput | PreviewJsonData>(
        async () => {
          const result = await fetchAndFilterPreview(lastN, resourceTypes, peekSection(options));
          if (!result.success) {
            return createErrorResult(result.error, result.exitCode, result.suggestion);
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
