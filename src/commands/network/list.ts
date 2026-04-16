/**
 * Network list command with DevTools-compatible filter DSL.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { fetchNetworkRequests, createErrorResult } from '@/commands/shared/dataFetcher.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { applyFilters, getFilterHelpText, validateFilterString } from '@/telemetry/filterDsl.js';
import { resolvePreset, FILTER_PRESETS } from '@/telemetry/filterPresets.js';
import { filterByResourceType } from '@/telemetry/filters.js';
import type { NetworkRequest } from '@/types.js';
import { formatNetworkList, type NetworkListOptions } from '@/ui/formatters/networkList.js';
import {
  followingNetworkMessage,
  stoppedFollowingNetworkMessage,
} from '@/ui/messages/networkMessages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { validateFilterOption } from './shared.js';

const MIN_LAST = 0;
const MAX_LAST = 10000;
const DEFAULT_LAST = 100;
const FOLLOW_LIMIT = 50;
const FOLLOW_INTERVAL = 1000;

interface NetworkListCommandOptions extends BaseOptions {
  filter?: string;
  preset?: string;
  type?: string;
  last?: string;
  follow?: boolean;
  verbose?: boolean;
}

const networkLastOption = new Option(
  '--last <n>',
  `Show last N requests (0 = all, default: ${DEFAULT_LAST})`
).default(String(DEFAULT_LAST));

/**
 * Validate preset option early with typo detection.
 *
 * @param preset - Preset name from options
 * @throws CommandError with typo suggestion if invalid
 */
function validatePreset(preset?: string): void {
  if (preset) {
    resolvePreset(preset);
  }
}

function buildFilterString(options: NetworkListCommandOptions): string {
  const explicit = options.filter ?? '';
  if (!options.preset) return explicit;
  const presetFilter = resolvePreset(options.preset);
  return explicit ? `${presetFilter} ${explicit}` : presetFilter;
}

function validateAndGetFilters(options: NetworkListCommandOptions): void {
  const filterString = buildFilterString(options);
  if (!filterString) return;
  validateFilterOption(filterString);
}

/**
 * Parse and validate resource types from --type option.
 *
 * @param typeOption - Raw type option value
 * @returns Validated resource types array
 */
function parseResourceTypes(typeOption?: string): Protocol.Network.ResourceType[] {
  return resourceTypeRule().validate(typeOption);
}

/**
 * Filter requests using DSL filters and resource type filters.
 *
 * @param requests - Network requests to filter
 * @param options - Command options containing filter and type
 * @param resourceTypes - Pre-validated resource types
 * @returns Filtered network requests
 */
function filterRequests(
  requests: NetworkRequest[],
  options: NetworkListCommandOptions,
  resourceTypes: Protocol.Network.ResourceType[]
): NetworkRequest[] {
  let filtered = requests;

  const filterString = buildFilterString(options);
  if (filterString) {
    const validation = validateFilterString(filterString);
    if (validation.valid) {
      filtered = applyFilters(filtered, validation.filters);
    }
  }

  if (resourceTypes.length > 0) {
    filtered = filterByResourceType(filtered, resourceTypes);
  }

  return filtered;
}

function buildFormatOptions(
  options: NetworkListCommandOptions,
  totalCount: number,
  lastLimit: number,
  follow = false
): NetworkListOptions {
  return {
    json: options.json ?? false,
    verbose: options.verbose ?? false,
    last: lastLimit,
    totalCount,
    follow,
  };
}

async function runFollowMode(
  options: NetworkListCommandOptions,
  resourceTypes: Protocol.Network.ResourceType[]
): Promise<void> {
  const showNetwork = async (): Promise<void> => {
    const result = await fetchNetworkRequests();

    if (!result.success) {
      const errorResult = handleDaemonConnectionError(result.error, {
        json: options.json,
        follow: true,
        retryIntervalMs: FOLLOW_INTERVAL,
        exitCode: result.exitCode,
      });
      if (errorResult.shouldExit) process.exit(errorResult.exitCode);
      return;
    }

    const filtered = filterRequests(result.data, options, resourceTypes);
    const displayRequests = filtered.slice(-FOLLOW_LIMIT);
    const formatOptions = buildFormatOptions(options, filtered.length, FOLLOW_LIMIT, true);

    console.clear();
    console.log(formatNetworkList(displayRequests, formatOptions));
  };

  await setupFollowMode(showNetwork, {
    startMessage: followingNetworkMessage,
    stopMessage: stoppedFollowingNetworkMessage,
    intervalMs: FOLLOW_INTERVAL,
  });
}

function formatPresetHelp(): string {
  return Object.entries(FILTER_PRESETS)
    .map(([name, preset]) => `  ${name.padEnd(12)} ${preset.description}`)
    .join('\n');
}

interface NetworkListResult {
  requests: NetworkRequest[];
  filtered: NetworkRequest[];
  totalCount: number;
}

export function registerListCommand(networkCmd: Command): void {
  networkCmd
    .command('list')
    .description('List network requests with DevTools-compatible filtering')
    .addOption(jsonOption())
    .addOption(
      new Option(
        '--filter <dsl>',
        'Filter requests using DevTools DSL (e.g., "status-code:>=400 domain:api.*")'
      )
    )
    .addOption(new Option('--preset <name>', 'Use predefined filter preset'))
    .addOption(
      new Option(
        '--type <types>',
        'Filter by resource type (comma-separated: Document,XHR,Fetch,etc.)'
      )
    )
    .addOption(networkLastOption)
    .addOption(new Option('-f, --follow', 'Stream network requests in real-time').default(false))
    .addOption(new Option('-v, --verbose', 'Show full URLs and additional details').default(false))
    .addHelpText('after', `\n${getFilterHelpText()}\n\nPresets:\n${formatPresetHelp()}`)
    .action(async (options: NetworkListCommandOptions) => {
      let resourceTypes: Protocol.Network.ResourceType[];
      let lastN: number;

      try {
        validatePreset(options.preset);
        validateAndGetFilters(options);
        resourceTypes = parseResourceTypes(options.type);
        lastN = positiveIntRule({ min: MIN_LAST, max: MAX_LAST, default: DEFAULT_LAST }).validate(
          options.last
        );
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      if (options.follow) {
        await runFollowMode(options, resourceTypes);
        return;
      }

      await runCommand(
        async () => {
          const result = await fetchNetworkRequests();

          if (!result.success) {
            if (result.exitCode === EXIT_CODES.SUCCESS) {
              return { success: true, data: { requests: [], filtered: [], totalCount: 0 } };
            }
            return createErrorResult(result.error, result.exitCode);
          }

          const filtered = filterRequests(result.data, options, resourceTypes);
          return {
            success: true,
            data: { requests: result.data, filtered, totalCount: result.data.length },
          };
        },
        options,
        (data: NetworkListResult) => {
          const displayRequests = lastN === 0 ? data.filtered : data.filtered.slice(-lastN);
          return formatNetworkList(
            displayRequests,
            buildFormatOptions(options, data.totalCount, lastN)
          );
        }
      );
    });
}
