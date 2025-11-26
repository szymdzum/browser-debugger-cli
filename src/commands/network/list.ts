/**
 * Network list command with DevTools-compatible filter DSL.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { fetchNetworkRequests, createErrorResult } from '@/commands/shared/dataFetcher.js';
import { setupFollowMode } from '@/commands/shared/followMode.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { applyFilters, getFilterHelpText, validateFilterString } from '@/telemetry/filterDsl.js';
import { resolvePreset, FILTER_PRESETS } from '@/telemetry/filterPresets.js';
import type { NetworkRequest } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatNetworkList, type NetworkListOptions } from '@/ui/formatters/networkList.js';
import {
  followingNetworkMessage,
  stoppedFollowingNetworkMessage,
} from '@/ui/messages/networkMessages.js';
import { invalidLastRangeError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const MIN_LAST = 0;
const MAX_LAST = 10000;
const DEFAULT_LAST = 100;
const FOLLOW_LIMIT = 50;
const FOLLOW_INTERVAL = 1000;

interface NetworkListCommandOptions extends BaseOptions {
  filter?: string;
  preset?: string;
  last?: number;
  follow?: boolean;
  verbose?: boolean;
}

const networkLastOption = new Option(
  '--last <n>',
  `Show last N requests (0 = all, default: ${DEFAULT_LAST})`
)
  .default(DEFAULT_LAST)
  .argParser((val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < MIN_LAST || n > MAX_LAST) {
      throw new CommandError(
        invalidLastRangeError(MIN_LAST, MAX_LAST),
        { suggestion: `Use a value between ${MIN_LAST} and ${MAX_LAST}` },
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    return n;
  });

function buildFilterString(options: NetworkListCommandOptions): string {
  const explicit = options.filter ?? '';
  if (!options.preset) return explicit;
  const presetFilter = resolvePreset(options.preset);
  return explicit ? `${presetFilter} ${explicit}` : presetFilter;
}

function validateAndGetFilters(options: NetworkListCommandOptions): void {
  const filterString = buildFilterString(options);
  if (!filterString) return;

  const validation = validateFilterString(filterString);
  if (!validation.valid) {
    throw new CommandError(
      validation.error,
      { suggestion: validation.suggestion ?? 'Check filter syntax' },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
}

function filterRequests(
  requests: NetworkRequest[],
  options: NetworkListCommandOptions
): NetworkRequest[] {
  const filterString = buildFilterString(options);
  if (!filterString) return requests;

  const validation = validateFilterString(filterString);
  return validation.valid ? applyFilters(requests, validation.filters) : requests;
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

async function runFollowMode(options: NetworkListCommandOptions): Promise<void> {
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

    const filtered = filterRequests(result.data, options);
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
    .addOption(
      new Option('--preset <name>', 'Use predefined filter preset').choices(
        Object.keys(FILTER_PRESETS)
      )
    )
    .addOption(networkLastOption)
    .addOption(new Option('-f, --follow', 'Stream network requests in real-time').default(false))
    .addOption(new Option('-v, --verbose', 'Show full URLs and additional details').default(false))
    .addHelpText('after', `\n${getFilterHelpText()}\n\nPresets:\n${formatPresetHelp()}`)
    .action(async (options: NetworkListCommandOptions) => {
      validateAndGetFilters(options);

      if (options.follow) {
        await runFollowMode(options);
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

          const filtered = filterRequests(result.data, options);
          return {
            success: true,
            data: { requests: result.data, filtered, totalCount: result.data.length },
          };
        },
        options,
        (data: NetworkListResult) => {
          const lastCount = options.last ?? DEFAULT_LAST;
          const displayRequests = lastCount === 0 ? data.filtered : data.filtered.slice(-lastCount);
          return formatNetworkList(
            displayRequests,
            buildFormatOptions(options, data.totalCount, lastCount)
          );
        }
      );
    });
}
