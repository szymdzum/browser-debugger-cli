import type { Command } from 'commander';

import { startSessionViaDaemon } from '@/cli/handlers/daemonSessionController.js';
import {
  DEFAULT_DEBUG_PORT,
  DEFAULT_REUSE_TAB,
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
 */
interface CollectorOptions {
  /** Chrome debugging port as provided by the user. */
  port: string;
  /** Optional auto-stop timeout (seconds, string form). */
  timeout?: string;
  /** Whether to reuse an existing tab instead of creating one. */
  reuseTab?: boolean;
  /** Custom Chrome profile directory path. */
  userDataDir?: string;
  /** When true, disables default filtering of noisy data. */
  all?: boolean;
  /** Chrome launcher log level (verbose|info|error|silent). */
  logLevel?: string;
  /** Inline JSON string with Chrome preferences. */
  chromePrefs?: string;
  /** Path to JSON file with Chrome preferences. */
  chromePrefsFile?: string;
  /** Additional Chrome command-line flags. */
  chromeFlags?: string[];
  /** Milliseconds between CDP readiness checks. */
  connectionPollInterval?: string;
  /** Maximum retry attempts before failing. */
  maxConnectionRetries?: string;
  /** Fail if port is already in use. */
  portStrict?: boolean;
  /** Fetch all response bodies (override auto-optimization). */
  fetchAllBodies?: boolean;
  /** Comma-separated patterns for bodies to include (trumps exclude). */
  fetchBodiesInclude?: string;
  /** Comma-separated patterns for bodies to exclude. */
  fetchBodiesExclude?: string;
  /** Comma-separated URL patterns to capture (trumps exclude). */
  networkInclude?: string;
  /** Comma-separated URL patterns to exclude. */
  networkExclude?: string;
  /** Maximum response body size in megabytes (default: 5MB). */
  maxBodySize?: string;
  /** Use compact JSON format (no indentation) for output files. */
  compact?: boolean;
}

/**
 * Apply shared collector options to a command
 *
 * @param command - Commander.js Command instance to apply options to
 * @returns The modified Command instance with all collector options applied
 */
function applyCollectorOptions(command: Command): Command {
  return (
    command
      // Basic Options
      .optionsGroup('Basic Options:')
      .option('-p, --port <number>', PORT_OPTION_DESCRIPTION, DEFAULT_DEBUG_PORT)
      .option('-t, --timeout <seconds>', TIMEOUT_OPTION_DESCRIPTION)
      .option('-r, --reuse-tab', REUSE_TAB_OPTION_DESCRIPTION)
      .option('-u, --user-data-dir <path>', USER_DATA_DIR_OPTION_DESCRIPTION)
      .option('-a, --all', 'Include all data (disable filtering of tracking/analytics)')
      .option('--compact', 'Use compact JSON format (no indentation) for output files')

      // Chrome Configuration
      .optionsGroup('Chrome Configuration:')
      .option('-L, --log-level <level>', LOG_LEVEL_OPTION_DESCRIPTION)
      .option('-P, --chrome-prefs <json>', CHROME_PREFS_OPTION_DESCRIPTION)
      .option('-F, --chrome-prefs-file <path>', CHROME_PREFS_FILE_OPTION_DESCRIPTION)
      .option('-G, --chrome-flags <flags...>', CHROME_FLAGS_OPTION_DESCRIPTION)

      // Connection Settings
      .optionsGroup('Connection Settings:')
      .option('-I, --connection-poll-interval <ms>', CONNECTION_POLL_INTERVAL_OPTION_DESCRIPTION)
      .option('-R, --max-connection-retries <count>', MAX_CONNECTION_RETRIES_OPTION_DESCRIPTION)
      .option('-S, --port-strict', PORT_STRICT_OPTION_DESCRIPTION)

      // Network Optimization
      .optionsGroup('Network Optimization:')
      .option('-B, --fetch-all-bodies', 'Fetch all response bodies (override auto-optimization)')
      .option(
        '-i, --fetch-bodies-include <patterns>',
        'Only fetch bodies matching patterns (comma-separated wildcards, trumps exclude)'
      )
      .option(
        '-x, --fetch-bodies-exclude <patterns>',
        'Additional patterns to exclude from body fetching (comma-separated wildcards)'
      )
      .option(
        '-y, --network-include <patterns>',
        'Only capture URLs matching patterns (comma-separated wildcards, trumps exclude)'
      )
      .option(
        '-z, --network-exclude <patterns>',
        'Additional URL patterns to exclude (comma-separated wildcards)'
      )
      .option(
        '-m, --max-body-size <megabytes>',
        'Maximum response body size in MB (default: 5MB)',
        '5'
      )
  );
}

/**
 * Parse a string to integer, returning undefined if not provided
 * @param value - Optional string value to parse
 * @param fieldName - Name of the field being parsed (for error messages)
 * @returns Parsed integer or undefined if value was not provided
 * @throws Error if value is provided but not a valid integer
 */
function parseOptionalInt(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: "${value}" is not a valid integer`);
  }
  return parsed;
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
  const maxBodySizeMB = parseOptionalInt(options.maxBodySize, 'max-body-size');
  return {
    port: parseInt(options.port, 10),
    timeout: parseOptionalInt(options.timeout, 'timeout'),
    reuseTab: options.reuseTab ?? DEFAULT_REUSE_TAB,
    userDataDir: options.userDataDir,
    includeAll: options.all ?? false,
    logLevel: options.logLevel as 'verbose' | 'info' | 'error' | 'silent' | undefined,
    prefs: parseOptionalJson(options.chromePrefs),
    prefsFile: options.chromePrefsFile,
    chromeFlags: options.chromeFlags,
    connectionPollInterval: parseOptionalInt(
      options.connectionPollInterval,
      'connection-poll-interval'
    ),
    maxConnectionRetries: parseOptionalInt(options.maxConnectionRetries, 'max-connection-retries'),
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
  const sessionOptions = buildSessionOptions(options);

  // Always collect all 3 types (dom, network, console)
  const collectors: CollectorType[] = ['dom', 'network', 'console'];

  // Dispatch to daemon via IPC instead of running in-process
  await startSessionViaDaemon(url, sessionOptions, collectors);
}

/**
 * Register the start command
 *
 * @param program - Commander.js Command instance to register command on
 * @returns void
 */
export function registerStartCommands(program: Command): void {
  // Default command: always collects all 3 types (dom, network, console)
  applyCollectorOptions(
    program.argument('<url>', 'Target URL (example.com or localhost:3000)')
  ).action(async (url: string, options: CollectorOptions) => {
    await collectorAction(url, options);
  });
}
