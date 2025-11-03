import type { Command } from 'commander';

import { startSession } from '@/cli/handlers/sessionController.js';
import {
  DEFAULT_DEBUG_PORT,
  PORT_OPTION_DESCRIPTION,
  TIMEOUT_OPTION_DESCRIPTION,
  REUSE_TAB_OPTION_DESCRIPTION,
  USER_DATA_DIR_OPTION_DESCRIPTION,
  LOG_LEVEL_OPTION_DESCRIPTION,
  CHROME_PREFS_OPTION_DESCRIPTION,
  CHROME_PREFS_FILE_OPTION_DESCRIPTION,
  CHROME_FLAGS_OPTION_DESCRIPTION,
  CONNECTION_POLL_INTERVAL_OPTION_DESCRIPTION,
  MAX_CONNECTION_RETRIES_OPTION_DESCRIPTION,
  PORT_STRICT_OPTION_DESCRIPTION,
} from '@/constants';
import type { CollectorType } from '@/types';

/**
 * Parsed command-line flags shared by the start subcommands.
 * @property port                   Chrome debugging port as provided by the user.
 * @property timeout                Optional auto-stop timeout (seconds, string form).
 * @property reuseTab               Whether to reuse an existing tab instead of creating one.
 * @property userDataDir            Custom Chrome profile directory path.
 * @property all                    When true, disables default filtering of noisy data.
 * @property logLevel               Chrome launcher log level (verbose|info|error|silent).
 * @property chromePrefs            Inline JSON string with Chrome preferences.
 * @property chromePrefsFile        Path to JSON file with Chrome preferences.
 * @property chromeFlags            Additional Chrome command-line flags.
 * @property connectionPollInterval Milliseconds between CDP readiness checks.
 * @property maxConnectionRetries   Maximum retry attempts before failing.
 * @property portStrict             Fail if port is already in use.
 * @property dom                    Enable only DOM collector (additive).
 * @property network                Enable only network collector (additive).
 * @property console                Enable only console collector (additive).
 * @property skipDom                Disable DOM collector (subtractive).
 * @property skipNetwork            Disable network collector (subtractive).
 * @property skipConsole            Disable console collector (subtractive).
 * @property fetchAllBodies         Fetch all response bodies (override auto-optimization).
 * @property fetchBodiesInclude     Comma-separated patterns for bodies to include (trumps exclude).
 * @property fetchBodiesExclude     Comma-separated patterns for bodies to exclude.
 * @property networkInclude         Comma-separated URL patterns to capture (trumps exclude).
 * @property networkExclude         Comma-separated URL patterns to exclude.
 * @property maxBodySize            Maximum response body size in megabytes (default: 5MB).
 * @property compact                Use compact JSON format (no indentation) for output files.
 */
interface CollectorOptions {
  port: string;
  timeout?: string;
  reuseTab?: boolean;
  userDataDir?: string;
  all?: boolean;
  logLevel?: string;
  chromePrefs?: string;
  chromePrefsFile?: string;
  chromeFlags?: string[];
  connectionPollInterval?: string;
  maxConnectionRetries?: string;
  portStrict?: boolean;
  dom?: boolean;
  network?: boolean;
  console?: boolean;
  skipDom?: boolean;
  skipNetwork?: boolean;
  skipConsole?: boolean;
  fetchAllBodies?: boolean;
  fetchBodiesInclude?: string;
  fetchBodiesExclude?: string;
  networkInclude?: string;
  networkExclude?: string;
  maxBodySize?: string;
  compact?: boolean;
}

/**
 * Apply shared collector options to a command
 *
 * @param command - Commander.js Command instance to apply options to
 * @returns The modified Command instance with all collector options applied
 */
function applyCollectorOptions(command: Command): Command {
  return command
    .option('-p, --port <number>', PORT_OPTION_DESCRIPTION, DEFAULT_DEBUG_PORT)
    .option('-t, --timeout <seconds>', TIMEOUT_OPTION_DESCRIPTION)
    .option('-r, --reuse-tab', REUSE_TAB_OPTION_DESCRIPTION)
    .option('-u, --user-data-dir <path>', USER_DATA_DIR_OPTION_DESCRIPTION)
    .option('-a, --all', 'Include all data (disable filtering of tracking/analytics)')
    .option('-c, --compact', 'Use compact JSON format (no indentation) for output files')
    .option('--log-level <level>', LOG_LEVEL_OPTION_DESCRIPTION)
    .option('--chrome-prefs <json>', CHROME_PREFS_OPTION_DESCRIPTION)
    .option('--chrome-prefs-file <path>', CHROME_PREFS_FILE_OPTION_DESCRIPTION)
    .option('--chrome-flags <flags...>', CHROME_FLAGS_OPTION_DESCRIPTION)
    .option('--connection-poll-interval <ms>', CONNECTION_POLL_INTERVAL_OPTION_DESCRIPTION)
    .option('--max-connection-retries <count>', MAX_CONNECTION_RETRIES_OPTION_DESCRIPTION)
    .option('--port-strict', PORT_STRICT_OPTION_DESCRIPTION)
    .option('--dom', 'Enable only DOM collector (additive)')
    .option('--network', 'Enable only network collector (additive)')
    .option('--console', 'Enable only console collector (additive)')
    .option('--skip-dom', 'Disable DOM collector (subtractive)')
    .option('--skip-network', 'Disable network collector (subtractive)')
    .option('--skip-console', 'Disable console collector (subtractive)')
    .option('--fetch-all-bodies', 'Fetch all response bodies (override auto-optimization)')
    .option(
      '--fetch-bodies-include <patterns>',
      'Only fetch bodies matching patterns (comma-separated wildcards, trumps exclude)'
    )
    .option(
      '--fetch-bodies-exclude <patterns>',
      'Additional patterns to exclude from body fetching (comma-separated wildcards)'
    )
    .option(
      '--network-include <patterns>',
      'Only capture URLs matching patterns (comma-separated wildcards, trumps exclude)'
    )
    .option(
      '--network-exclude <patterns>',
      'Additional URL patterns to exclude (comma-separated wildcards)'
    )
    .option('--max-body-size <megabytes>', 'Maximum response body size in MB (default: 5MB)', '5');
}

/**
 * Parse a string to integer, returning undefined if not provided
 *
 * @param value - Optional string value to parse
 * @returns Parsed integer or undefined if value was not provided
 */
function parseOptionalInt(value: string | undefined): number | undefined {
  return value !== undefined ? parseInt(value, 10) : undefined;
}

/**
 * Parse comma-separated patterns into array
 *
 * @param value - Optional comma-separated patterns string
 * @returns Array of patterns or undefined if value was not provided
 */
function parsePatterns(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Parse JSON string with error handling
 *
 * @param value - Optional JSON string to parse
 * @returns Parsed JSON object or undefined if value was not provided
 * @throws Error if JSON parsing fails
 */
function parseOptionalJson(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid JSON in --chrome-prefs: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate collector flags for conflicts
 *
 * @param options - Parsed command-line options from Commander
 * @throws Error if conflicting flags are detected (e.g., --dom and --no-dom)
 */
export function validateCollectorFlags(options: CollectorOptions): void {
  const conflicts: string[] = [];

  if (options.dom && options.skipDom) {
    conflicts.push('--dom and --skip-dom');
  }
  if (options.network && options.skipNetwork) {
    conflicts.push('--network and --skip-network');
  }
  if (options.console && options.skipConsole) {
    conflicts.push('--console and --skip-console');
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Conflicting collector flags detected: ${conflicts.join(', ')}. ` +
        'Use either additive flags (--dom, --network, --console) or subtractive flags (--skip-dom, --skip-network, --skip-console), not both for the same collector.'
    );
  }
}

/**
 * Resolve which collectors to activate based on CLI flags
 *
 * @param options - Parsed command-line options from Commander
 * @returns Array of collector types to activate
 *
 * Logic:
 * - If any additive flags (--dom, --network, --console) are present, return only those collectors
 * - If subtractive flags (--skip-dom, --skip-network, --skip-console) are present, return all collectors minus excluded ones
 * - If no collector flags are present, return all collectors (default)
 */
export function resolveCollectors(options: CollectorOptions): CollectorType[] {
  const allCollectors: CollectorType[] = ['dom', 'network', 'console'];

  // Check for additive flags
  const hasAdditive = options.dom ?? options.network ?? options.console;
  if (hasAdditive) {
    const collectors: CollectorType[] = [];
    if (options.dom) collectors.push('dom');
    if (options.network) collectors.push('network');
    if (options.console) collectors.push('console');
    return collectors;
  }

  // Check for subtractive flags
  const hasSubtractive = options.skipDom ?? options.skipNetwork ?? options.skipConsole;
  if (hasSubtractive) {
    const collectors = [...allCollectors];
    if (options.skipDom) {
      const index = collectors.indexOf('dom');
      if (index > -1) collectors.splice(index, 1);
    }
    if (options.skipNetwork) {
      const index = collectors.indexOf('network');
      if (index > -1) collectors.splice(index, 1);
    }
    if (options.skipConsole) {
      const index = collectors.indexOf('console');
      if (index > -1) collectors.splice(index, 1);
    }
    return collectors;
  }

  // Default: return all collectors
  return allCollectors;
}

/**
 * Transform CLI options into session options
 *
 * @param options - Parsed command-line options from Commander
 * @returns Session options object with parsed and normalized values
 */
function buildSessionOptions(options: CollectorOptions): {
  port: number;
  timeout: number | undefined;
  reuseTab: boolean;
  userDataDir: string | undefined;
  includeAll: boolean;
  logLevel: 'verbose' | 'info' | 'error' | 'silent' | undefined;
  prefs: Record<string, unknown> | undefined;
  prefsFile: string | undefined;
  chromeFlags: string[] | undefined;
  connectionPollInterval: number | undefined;
  maxConnectionRetries: number | undefined;
  portStrictMode: boolean;
  fetchAllBodies: boolean;
  fetchBodiesInclude: string[] | undefined;
  fetchBodiesExclude: string[] | undefined;
  networkInclude: string[] | undefined;
  networkExclude: string[] | undefined;
  maxBodySize: number | undefined;
  compact: boolean;
} {
  const maxBodySizeMB = parseOptionalInt(options.maxBodySize);
  return {
    port: parseInt(options.port, 10),
    timeout: parseOptionalInt(options.timeout),
    reuseTab: options.reuseTab ?? false,
    userDataDir: options.userDataDir,
    includeAll: options.all ?? false,
    logLevel: options.logLevel as 'verbose' | 'info' | 'error' | 'silent' | undefined,
    prefs: parseOptionalJson(options.chromePrefs),
    prefsFile: options.chromePrefsFile,
    chromeFlags: options.chromeFlags,
    connectionPollInterval: parseOptionalInt(options.connectionPollInterval),
    maxConnectionRetries: parseOptionalInt(options.maxConnectionRetries),
    portStrictMode: options.portStrict ?? false,
    fetchAllBodies: options.fetchAllBodies ?? false,
    fetchBodiesInclude: parsePatterns(options.fetchBodiesInclude),
    fetchBodiesExclude: parsePatterns(options.fetchBodiesExclude),
    networkInclude: parsePatterns(options.networkInclude),
    networkExclude: parsePatterns(options.networkExclude),
    maxBodySize: maxBodySizeMB !== undefined ? maxBodySizeMB * 1024 * 1024 : undefined,
    compact: options.compact ?? false,
  };
}

/**
 * Common action handler for collector commands
 *
 * @param url - Target URL to collect telemetry from
 * @param options - Parsed command-line options from Commander
 * @returns Promise that resolves when session completes or is stopped
 */
async function collectorAction(url: string, options: CollectorOptions): Promise<void> {
  // Validate collector flags for conflicts
  validateCollectorFlags(options);

  // Resolve which collectors to activate based on flags
  const collectors = resolveCollectors(options);

  const sessionOptions = buildSessionOptions(options);
  await startSession(url, sessionOptions, collectors);
}

/**
 * Register the start command
 *
 * @param program - Commander.js Command instance to register command on
 * @returns void
 */
export function registerStartCommands(program: Command): void {
  // Default command: collectors determined by flags
  // Use --dom, --network, --console (additive) or --no-dom, --no-network, --no-console (subtractive)
  // If no collector flags provided, all collectors are activated
  applyCollectorOptions(
    program.argument('<url>', 'Target URL (example.com or localhost:3000)')
  ).action(async (url: string, options: CollectorOptions) => {
    await collectorAction(url, options);
  });
}
