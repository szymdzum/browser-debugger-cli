/**
 * Network list command with DevTools-compatible filter DSL.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import { noteFollowConnected } from '@/commands/shared/daemonErrorHandler.js';
import { fetchNetworkRequests, createErrorResult } from '@/commands/shared/dataFetcher.js';
import {
  followFetchFailure,
  newPageCrashes,
  setupFollowMode,
  type FollowPoll,
} from '@/commands/shared/followMode.js';
import { handleValidationError } from '@/commands/shared/handleValidationError.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule, resourceTypeRule } from '@/commands/shared/validation.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { applyFilters, getFilterHelpText, validateFilterString } from '@/telemetry/filterDsl.js';
import { resolvePreset, FILTER_PRESETS } from '@/telemetry/filterPresets.js';
import { filterByResourceType } from '@/telemetry/filters.js';
import type { NetworkRequest } from '@/types.js';
import { buildSuccessResponse } from '@/ui/OutputBuilder.js';
import {
  formatNetworkFollowRows,
  formatNetworkList,
  pageStartOf,
  type NetworkListOptions,
  type PageStart,
} from '@/ui/formatters/networkList.js';
import { pageCrashedNote, withPageCrashedNote } from '@/ui/messages/commands.js';
import {
  followingNetworkMessage,
  stoppedFollowingNetworkMessage,
} from '@/ui/messages/networkMessages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { validateFilterOption } from './shared.js';

const MIN_LAST = 0;
const MAX_LAST = 10000;
const DEFAULT_LAST = 100;
const FOLLOW_INTERVAL = 1000;

interface NetworkListCommandOptions extends BaseOptions {
  filter?: string;
  preset?: string;
  type?: string;
  last?: string;
  follow?: boolean;
  verbose?: boolean;
}

const networkLastOption = new Option('--last <n>', 'Show last N requests (0 = all)').default(
  String(DEFAULT_LAST)
);

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
 * Whether the active filters inspect headers, which the list only fetches on demand.
 *
 * @param options - Command options
 * @returns True when headers must be fetched for filtering
 */
function filtersNeedHeaders(options: NetworkListCommandOptions): boolean {
  return /has-response-header:|is:from-cache/.test(buildFilterString(options));
}

/**
 * Drop headers fetched only for filtering, keeping the list output unchanged.
 *
 * @param request - Request with headers
 * @returns Request without request/response headers
 */
function withoutHeaders(request: NetworkRequest): NetworkRequest {
  const { requestHeaders: _requestHeaders, responseHeaders: _responseHeaders, ...rest } = request;
  return rest;
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

  return filtersNeedHeaders(options) ? filtered.map(withoutHeaders) : filtered;
}

/**
 * Formatter options for a listing.
 *
 * @param options - Command options
 * @param result - Requests listed, with their counts
 * @param lastLimit - The --last limit
 * @returns Formatter options
 */
function buildFormatOptions(
  options: NetworkListCommandOptions,
  result: NetworkListResult,
  lastLimit: number
): NetworkListOptions {
  return {
    verbose: options.verbose ?? false,
    last: lastLimit,
    totalCount: result.totalCount,
    filteredCount: result.filteredCount,
    ...(result.pageStart && { pageStart: result.pageStart }),
    evictions: {
      requestsDropped: result.dropped ?? 0,
      bodiesEvicted: result.bodiesEvicted ?? 0,
    },
  };
}

/**
 * Stream network requests: the last `lastN` finished ones at start, then
 * each request once, when it has finished loading or failed (a request whose
 * headers arrived but whose body is still loading waits), like `tail -f`,
 * with a warning (JSON `pageCrashedAt`) once when the page crashes.
 *
 * @param options - Command options
 * @param resourceTypes - Validated resource types
 * @param lastN - Requests to show at start (0 = all)
 */
async function runFollowMode(
  options: NetworkListCommandOptions,
  resourceTypes: Protocol.Network.ResourceType[],
  lastN: number
): Promise<void> {
  const shown = new Set<string>();
  const newCrash = newPageCrashes();
  let started = false;
  const showNetwork = async (): Promise<FollowPoll> => {
    const result = await fetchNetworkRequests(filtersNeedHeaders(options));
    if (!result.success) {
      return followFetchFailure(result, { json: options.json, retryIntervalMs: FOLLOW_INTERVAL });
    }
    noteFollowConnected();

    const { requests } = result.data;
    const crashedAt = newCrash(result.data.pageCrashedAt);
    const finished = filterRequests(requests, options, resourceTypes).filter(
      (request) => request.duration !== undefined && !shown.has(request.requestId)
    );
    const present = new Set(requests.map((request) => request.requestId));
    for (const id of shown) if (!present.has(id)) shown.delete(id);
    finished.forEach((request) => shown.add(request.requestId));
    const fresh = started || lastN === 0 ? finished : finished.slice(-lastN);
    if (options.json) {
      if (!started || fresh.length > 0 || crashedAt !== undefined) {
        const data: NetworkListResult = {
          requests: fresh,
          totalCount: requests.length,
          filteredCount: fresh.length,
          ...(crashedAt !== undefined && { pageCrashedAt: crashedAt }),
        };
        console.log(JSON.stringify(buildSuccessResponse(data)));
      }
    } else {
      const pageStart = pageStartOf(requests);
      const text = formatNetworkFollowRows(fresh, {
        header: !started,
        verbose: options.verbose ?? false,
        ...(pageStart && { pageStart }),
      });
      if (text) console.log(text);
      if (crashedAt !== undefined) console.log(pageCrashedNote(crashedAt));
    }
    started = true;
    return undefined;
  };

  await setupFollowMode(showNetwork, {
    startMessage: followingNetworkMessage,
    stopMessage: stoppedFollowingNetworkMessage,
    intervalMs: FOLLOW_INTERVAL,
  });
}

/** What the less obvious columns of the list mean */
const COLUMNS_HELP = `Columns:
  START  When the request started, from the start of the current page (its document
         request): +1.2s. Requests of earlier pages are negative. --json has the
         absolute time (timestamp, epoch ms) and data.pageStart.
  TIME   How long it took (to its last byte or failure); - while pending`;

function formatPresetHelp(): string {
  return Object.entries(FILTER_PRESETS)
    .map(([name, preset]) => `  ${name.padEnd(12)} ${preset.description}`)
    .join('\n');
}

/**
 * `network list` result (the `data` of `--json`).
 */
interface NetworkListResult {
  /** Requests after filters and `--last`, oldest first */
  requests: NetworkRequest[];
  /** All captured requests, before filters */
  totalCount: number;
  /** Requests matching the filters, before `--last` */
  filteredCount: number;
  /**
   * Start of the current page (its document request) that the START column
   * counts from: `timestamp` (epoch ms) and `sentTime` (Chrome's monotonic
   * time, seconds), like the requests' own
   */
  pageStart?: PageStart;
  /** When the page crashed (epoch ms), while it is not loaded again */
  pageCrashedAt?: number;
  /** Oldest finished requests the session dropped at its cap (left out when none) */
  dropped?: number;
  /** Oldest response bodies the session evicted at its body budget (left out when none) */
  bodiesEvicted?: number;
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
      new Option(
        '--preset <name>',
        `Use predefined filter preset: ${Object.keys(FILTER_PRESETS).join(', ')}`
      )
    )
    .addOption(
      new Option(
        '--type <types>',
        'Filter by resource type (comma-separated: Document,XHR,Fetch,etc.)'
      )
    )
    .addOption(networkLastOption)
    .addOption(new Option('-f, --follow', 'Stream network requests in real-time').default(false))
    .addOption(new Option('-v, --verbose', 'Show full URLs and additional details').default(false))
    .addHelpText(
      'after',
      `\n${COLUMNS_HELP}\n\n${getFilterHelpText()}\n\nPresets:\n${formatPresetHelp()}`
    )
    .action(async (options: NetworkListCommandOptions) => {
      let resourceTypes: Protocol.Network.ResourceType[];
      let lastN: number;

      try {
        validatePreset(options.preset);
        validateAndGetFilters(options);
        resourceTypes = parseResourceTypes(options.type);
        lastN = positiveIntRule({
          name: '--last',
          min: MIN_LAST,
          max: MAX_LAST,
          default: DEFAULT_LAST,
        }).validate(options.last);
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      if (options.follow) {
        await runFollowMode(options, resourceTypes, lastN);
        return;
      }

      await runCommand(
        async () => {
          const result = await fetchNetworkRequests(filtersNeedHeaders(options));

          if (!result.success) {
            if (result.exitCode === EXIT_CODES.SUCCESS) {
              return { success: true, data: { requests: [], totalCount: 0, filteredCount: 0 } };
            }
            return createErrorResult(result.error, result.exitCode, result.suggestion);
          }

          const { requests, pageCrashedAt, evictions } = result.data;
          const filtered = filterRequests(requests, options, resourceTypes);
          const pageStart = pageStartOf(requests);
          return {
            success: true,
            data: {
              requests: lastN === 0 ? filtered : filtered.slice(-lastN),
              totalCount: requests.length,
              filteredCount: filtered.length,
              ...(pageStart && { pageStart }),
              ...(pageCrashedAt !== undefined && { pageCrashedAt }),
              ...(evictions.requestsDropped > 0 && { dropped: evictions.requestsDropped }),
              ...(evictions.bodiesEvicted > 0 && { bodiesEvicted: evictions.bodiesEvicted }),
            },
          };
        },
        options,
        (data: NetworkListResult) =>
          withPageCrashedNote(
            formatNetworkList(data.requests, buildFormatOptions(options, data, lastN)),
            data.pageCrashedAt
          )
      );
    });
}
