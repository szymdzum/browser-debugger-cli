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
import { CommandError } from '@/errors/index.js';
import { conflictingOptionsError } from '@/errors/messages.js';
import type { TabSwitchInfo } from '@/ipc/protocol/tabTypes.js';
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
import { pageCrashedNote, withPageCrashedNote, withTabSwitchNote } from '@/ui/messages/commands.js';
import {
  followingNetworkMessage,
  stoppedFollowingNetworkMessage,
  type NetworkEvictionCounts,
} from '@/ui/messages/networkMessages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import {
  defaultPageScope,
  pageScopeOption,
  scopeToPage,
  selectRequests,
  sortKeyOption,
  type PageScope,
  type SortKey,
} from './listScope.js';
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
  page?: PageScope;
  sort?: SortKey;
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
 * @param currentNavigationId - The session's current navigation id (for `page:current`)
 * @returns Filtered network requests
 */
function filterRequests(
  requests: NetworkRequest[],
  options: NetworkListCommandOptions,
  resourceTypes: Protocol.Network.ResourceType[],
  currentNavigationId: number | undefined
): NetworkRequest[] {
  let filtered = requests;

  const filterString = buildFilterString(options);
  if (filterString) {
    const validation = validateFilterString(filterString);
    if (validation.valid) {
      filtered = applyFilters(filtered, validation.filters, { currentNavigationId });
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
    ...(options.sort && { sort: options.sort }),
    ...(result.hiddenEarlierPages && { hiddenEarlierPages: result.hiddenEarlierPages }),
    ...(result.pageStart && { pageStart: result.pageStart }),
    evictions: {
      requestsDropped: result.dropped ?? 0,
      bodiesEvicted: result.bodiesEvicted ?? 0,
    },
  };
}

/**
 * Watch the session's dropped/evicted counts across follow polls, so the
 * stream notes them once per kind instead of on every poll.
 *
 * @returns Function giving the counts when requests or bodies were let go
 *   for the first time since the stream started, otherwise undefined
 */
function newEvictionKinds(): (counts: NetworkEvictionCounts) => NetworkEvictionCounts | undefined {
  let requestsNoted = false;
  let bodiesNoted = false;
  return (counts) => {
    const newRequests = !requestsNoted && counts.requestsDropped > 0;
    const newBodies = !bodiesNoted && counts.bodiesEvicted > 0;
    requestsNoted ||= newRequests;
    bodiesNoted ||= newBodies;
    return newRequests || newBodies ? counts : undefined;
  };
}

/**
 * JSON fields of the dropped/evicted counts (the non-zero ones).
 *
 * @param counts - Counts to report, if any
 * @returns `dropped` and `bodiesEvicted` when non-zero
 */
function evictionFields(
  counts: NetworkEvictionCounts | undefined
): Pick<NetworkListResult, 'dropped' | 'bodiesEvicted'> {
  if (!counts) return {};
  return {
    ...(counts.requestsDropped > 0 && { dropped: counts.requestsDropped }),
    ...(counts.bodiesEvicted > 0 && { bodiesEvicted: counts.bodiesEvicted }),
  };
}

/**
 * Stream network requests: the last `lastN` finished ones at start, then
 * each request once, when it has finished loading or failed (a request whose
 * headers arrived but whose body is still loading waits), like `tail -f`,
 * with a warning (JSON `pageCrashedAt`) once when the page crashes, and a
 * note (JSON `dropped`, `bodiesEvicted`) the first time the session drops
 * requests or evicts bodies at its limits.
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
  const newEviction = newEvictionKinds();
  let started = false;
  const showNetwork = async (): Promise<FollowPoll> => {
    const result = await fetchNetworkRequests(filtersNeedHeaders(options));
    if (!result.success) {
      return followFetchFailure(result, { json: options.json, retryIntervalMs: FOLLOW_INTERVAL });
    }
    noteFollowConnected();

    const { requests, currentNavigationId } = result.data;
    const crashedAt = newCrash(result.data.pageCrashedAt);
    const evictions = newEviction(result.data.evictions);
    const matching = filterRequests(requests, options, resourceTypes, currentNavigationId);
    const scope = options.page ?? defaultPageScope(options.preset);
    const finished = scopeToPage(matching, scope, currentNavigationId).requests.filter(
      (request) => request.duration !== undefined && !shown.has(request.requestId)
    );
    const present = new Set(requests.map((request) => request.requestId));
    for (const id of shown) if (!present.has(id)) shown.delete(id);
    finished.forEach((request) => shown.add(request.requestId));
    const fresh = started || lastN === 0 ? finished : finished.slice(-lastN);
    if (options.json) {
      if (!started || fresh.length > 0 || crashedAt !== undefined || evictions) {
        const data: NetworkListResult = {
          requests: fresh,
          totalCount: requests.length,
          filteredCount: fresh.length,
          ...(crashedAt !== undefined && { pageCrashedAt: crashedAt }),
          ...evictionFields(evictions),
        };
        console.log(JSON.stringify(buildSuccessResponse(data)));
      }
    } else {
      const pageStart = pageStartOf(requests);
      const text = formatNetworkFollowRows(fresh, {
        header: !started,
        verbose: options.verbose ?? false,
        ...(pageStart && { pageStart }),
        ...(evictions && { evictions }),
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
    .map(
      ([name, preset]) =>
        `  ${name.padEnd(12)} ${preset.description}${preset.page ? ' (current page; --page all for every page)' : ''}`
    )
    .join('\n');
}

/**
 * `network list` result (the `data` of `--json`).
 */
interface NetworkListResult {
  /** Requests after filters and `--last`: oldest first, or in `--sort` order */
  requests: NetworkRequest[];
  /** All captured requests, before filters */
  totalCount: number;
  /** Requests matching the filters (and `--page`), before `--last` */
  filteredCount: number;
  /** Page scope applied: `current` when `--page current` or the preset's default left out earlier pages */
  page?: 'current';
  /** Requests of earlier pages matching the filters that `--page current` left out (left out when none) */
  hiddenEarlierPages?: number;
  /** Order of `requests` (`--sort`; left out: capture order) */
  sort?: SortKey;
  /**
   * Start of the current page (its document request) that the START column
   * counts from: `timestamp` (epoch ms) and `sentTime` (Chrome's monotonic
   * time, seconds), like the requests' own
   */
  pageStart?: PageStart;
  /** When the page crashed (epoch ms), while it is not loaded again */
  pageCrashedAt?: number;
  /** The session's latest move to another tab: that tab's earlier requests are not recorded, and those before `at` are another tab's */
  tabSwitch?: TabSwitchInfo;
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
    .addOption(
      new Option(
        '--page <scope>',
        'Requests of the current page or of all pages: current, all (default: current for --preset errors|failed|slow, else all)'
      ).argParser(pageScopeOption)
    )
    .addOption(
      new Option(
        '--sort <key>',
        'Order: size or duration (largest/slowest first; --last n keeps the top n), start'
      ).argParser(sortKeyOption)
    )
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
        if (options.follow && options.sort) {
          const err = conflictingOptionsError('--sort', '--follow');
          throw new CommandError(
            err.message,
            { suggestion: err.suggestion },
            EXIT_CODES.INVALID_ARGUMENTS
          );
        }
      } catch (error) {
        handleValidationError(error, options.json ?? false);
      }

      if (options.follow) {
        await runFollowMode(options, resourceTypes, lastN);
        return;
      }

      await runCommand(
        async () => {
          const result = await fetchNetworkRequests(filtersNeedHeaders(options), true);

          if (!result.success) {
            if (result.exitCode === EXIT_CODES.SUCCESS) {
              return { success: true, data: { requests: [], totalCount: 0, filteredCount: 0 } };
            }
            return createErrorResult(result.error, result.exitCode, result.suggestion);
          }

          const { requests, currentNavigationId, pageCrashedAt, tabSwitch, evictions } =
            result.data;
          const matching = filterRequests(requests, options, resourceTypes, currentNavigationId);
          const scope = options.page ?? defaultPageScope(options.preset);
          const scoped = scopeToPage(matching, scope, currentNavigationId);
          const pageStart = pageStartOf(requests);
          return {
            success: true,
            data: {
              requests: selectRequests(scoped.requests, options.sort, lastN),
              totalCount: requests.length,
              filteredCount: scoped.requests.length,
              ...(scope === 'current' && { page: 'current' as const }),
              ...(scoped.hidden > 0 && { hiddenEarlierPages: scoped.hidden }),
              ...(options.sort && { sort: options.sort }),
              ...(pageStart && { pageStart }),
              ...(pageCrashedAt !== undefined && { pageCrashedAt }),
              ...(tabSwitch && { tabSwitch }),
              ...evictionFields(evictions),
            },
          };
        },
        options,
        (data: NetworkListResult) =>
          withPageCrashedNote(
            withTabSwitchNote(
              formatNetworkList(data.requests, buildFormatOptions(options, data, lastN)),
              data.tabSwitch,
              'network'
            ),
            data.pageCrashedAt
          )
      );
    });
}
