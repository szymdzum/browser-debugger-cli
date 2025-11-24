/**
 * Network list command with DevTools-compatible filter DSL.
 *
 * Provides powerful filtering capabilities for network requests including
 * status codes, domains, HTTP methods, MIME types, size thresholds, and more.
 */

import { Option, type Command } from 'commander';

import { jsonOption } from '@/commands/shared/commonOptions.js';
import { handleDaemonConnectionError } from '@/commands/shared/daemonErrorHandler.js';
import { getErrorMessage } from '@/connection/errors.js';
import { getPeek } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { applyFilters, getFilterHelpText, validateFilterString } from '@/telemetry/filterDsl.js';
import { resolvePreset, FILTER_PRESETS } from '@/telemetry/filterPresets.js';
import type { BdgOutput, NetworkRequest } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatNetworkList, type NetworkListOptions } from '@/ui/formatters/networkList.js';
import {
  followingNetworkMessage,
  noNetworkDataMessage,
  stoppedFollowingNetworkMessage,
} from '@/ui/messages/networkMessages.js';
import { invalidLastRangeError } from '@/ui/messages/validation.js';
import { getExitCodeForConnectionError } from '@/utils/errorMapping.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const MIN_LAST_ITEMS = 0;
const MAX_LAST_ITEMS = 10000;
const DEFAULT_LAST_ITEMS = 100;
const FOLLOW_MODE_LIMIT = 50;
const FOLLOW_INTERVAL_MS = 1000;

interface NetworkListCommandOptions {
  json?: boolean;
  filter?: string;
  preset?: string;
  last?: number;
  follow?: boolean;
  verbose?: boolean;
}

const networkLastOption = new Option(
  '--last <n>',
  `Show last N requests (0 = all, default: ${DEFAULT_LAST_ITEMS})`
)
  .default(DEFAULT_LAST_ITEMS)
  .argParser(parseLastOption);

const filterDslOption = new Option(
  '--filter <dsl>',
  'Filter requests using DevTools DSL (e.g., "status-code:>=400 domain:api.*")'
);

const presetOption = new Option('--preset <name>', 'Use predefined filter preset').choices(
  Object.keys(FILTER_PRESETS)
);

const followOption = new Option('-f, --follow', 'Stream network requests in real-time').default(
  false
);

const verboseOption = new Option('-v, --verbose', 'Show full URLs and additional details').default(
  false
);

/**
 * Parse and validate --last option value.
 */
function parseLastOption(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < MIN_LAST_ITEMS || n > MAX_LAST_ITEMS) {
    throw new CommandError(
      invalidLastRangeError(MIN_LAST_ITEMS, MAX_LAST_ITEMS),
      {},
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return n;
}

/**
 * Build combined filter string from preset and explicit filter.
 */
function buildFilterString(options: NetworkListCommandOptions): string {
  const explicit = options.filter ?? '';
  if (!options.preset) return explicit;

  const presetFilter = resolvePreset(options.preset);
  return explicit ? `${presetFilter} ${explicit}` : presetFilter;
}

/**
 * Validate filter syntax and throw CommandError if invalid.
 */
function validateFilterOptions(options: NetworkListCommandOptions): void {
  const filterString = buildFilterString(options);
  if (!filterString) return;

  const validation = validateFilterString(filterString);
  if (validation.valid) return;

  const metadata = validation.suggestion ? { suggestion: validation.suggestion } : {};
  throw new CommandError(validation.error, metadata, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Apply filters to requests array.
 */
function filterRequests(
  requests: NetworkRequest[],
  options: NetworkListCommandOptions
): NetworkRequest[] {
  const filterString = buildFilterString(options);
  if (!filterString) return requests;

  const validation = validateFilterString(filterString);
  return validation.valid ? applyFilters(requests, validation.filters) : requests;
}

/**
 * Handle empty network data response.
 */
function handleEmptyNetworkData(options: NetworkListCommandOptions): never {
  if (options.json) {
    console.log(JSON.stringify({ success: true, data: [], count: 0 }));
  } else {
    console.log(noNetworkDataMessage());
  }
  process.exit(EXIT_CODES.SUCCESS);
}

/**
 * Handle IPC validation error with daemon error handler.
 */
function handleValidationError(error: unknown, options: NetworkListCommandOptions): boolean {
  const errorMsg = getErrorMessage(error);
  const exitCode = getExitCodeForConnectionError(errorMsg);
  const result = handleDaemonConnectionError(errorMsg, {
    json: options.json,
    follow: options.follow,
    retryIntervalMs: FOLLOW_INTERVAL_MS,
    exitCode,
  });

  if (result.shouldExit) {
    process.exit(result.exitCode);
  }
  return false;
}

/**
 * Handle daemon connection failure.
 */
function handleConnectionFailure(options: NetworkListCommandOptions): null {
  const result = handleDaemonConnectionError('Daemon not running', {
    json: options.json,
    follow: options.follow,
    retryIntervalMs: FOLLOW_INTERVAL_MS,
  });

  if (result.shouldExit) {
    process.exit(result.exitCode);
  }
  return null;
}

/**
 * Fetch network requests from the daemon.
 */
async function fetchNetworkRequests(
  options: NetworkListCommandOptions
): Promise<NetworkRequest[] | null> {
  try {
    const response = await getPeek();

    try {
      validateIPCResponse(response);
    } catch (validationError) {
      handleValidationError(validationError, options);
      return null;
    }

    const output = response.data?.preview as BdgOutput | undefined;
    if (!output?.data.network) {
      handleEmptyNetworkData(options);
    }

    return output.data.network;
  } catch {
    return handleConnectionFailure(options);
  }
}

/**
 * Build format options for display functions.
 */
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

/**
 * Display network requests in standard mode.
 */
function displayNetworkList(requests: NetworkRequest[], options: NetworkListCommandOptions): void {
  const lastCount = options.last ?? DEFAULT_LAST_ITEMS;
  const displayRequests = lastCount === 0 ? requests : requests.slice(-lastCount);
  const formatOptions = buildFormatOptions(options, requests.length, lastCount);

  console.log(formatNetworkList(displayRequests, formatOptions));
}

/**
 * Display network requests in follow/streaming mode.
 */
function displayNetworkStreaming(
  requests: NetworkRequest[],
  options: NetworkListCommandOptions
): void {
  const displayRequests = requests.slice(-FOLLOW_MODE_LIMIT);
  const formatOptions = buildFormatOptions(options, requests.length, FOLLOW_MODE_LIMIT, true);

  console.clear();
  console.log(formatNetworkList(displayRequests, formatOptions));
}

/**
 * Handle CommandError with appropriate output format.
 */
function handleCommandError(error: CommandError, json: boolean): never {
  if (json) {
    console.log(JSON.stringify({ success: false, error: error.message }));
  } else {
    console.error(error.message);
    if (error.metadata?.suggestion) {
      console.error(error.metadata.suggestion);
    }
  }
  process.exit(error.exitCode);
}

/**
 * Process and display filtered network requests.
 */
async function processNetworkRequests(
  options: NetworkListCommandOptions,
  displayFn: (requests: NetworkRequest[], options: NetworkListCommandOptions) => void
): Promise<void> {
  const requests = await fetchNetworkRequests(options);
  if (!requests) return;

  try {
    const filtered = filterRequests(requests, options);
    displayFn(filtered, options);
  } catch (error) {
    if (error instanceof CommandError) {
      handleCommandError(error, options.json ?? false);
    }
    throw error;
  }
}

/**
 * Run follow mode with periodic updates.
 */
async function runFollowMode(options: NetworkListCommandOptions): Promise<void> {
  console.error(followingNetworkMessage());

  const refresh = (): Promise<void> => processNetworkRequests(options, displayNetworkStreaming);

  await refresh();

  const intervalId = setInterval(() => {
    void refresh();
  }, FOLLOW_INTERVAL_MS);

  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.error(stoppedFollowingNetworkMessage());
    process.exit(EXIT_CODES.SUCCESS);
  });
}

/**
 * Run standard (non-follow) mode.
 */
async function runStandardMode(options: NetworkListCommandOptions): Promise<void> {
  await processNetworkRequests(options, displayNetworkList);
}

/**
 * Execute network list command action.
 */
async function executeNetworkList(options: NetworkListCommandOptions): Promise<void> {
  try {
    validateFilterOptions(options);
  } catch (error) {
    if (error instanceof CommandError) {
      handleCommandError(error, options.json ?? false);
    }
    throw error;
  }

  if (options.follow) {
    await runFollowMode(options);
  } else {
    await runStandardMode(options);
  }
}

/**
 * Format preset help text for command help output.
 */
function formatPresetHelp(): string {
  return Object.entries(FILTER_PRESETS)
    .map(([name, preset]) => `  ${name.padEnd(12)} ${preset.description}`)
    .join('\n');
}

/**
 * Register network list command.
 *
 * @param networkCmd - Network parent command
 */
export function registerListCommand(networkCmd: Command): void {
  networkCmd
    .command('list')
    .description('List network requests with DevTools-compatible filtering')
    .addOption(jsonOption())
    .addOption(filterDslOption)
    .addOption(presetOption)
    .addOption(networkLastOption)
    .addOption(followOption)
    .addOption(verboseOption)
    .addHelpText('after', `\n${getFilterHelpText()}\n\nPresets:\n${formatPresetHelp()}`)
    .action(executeNetworkList);
}
