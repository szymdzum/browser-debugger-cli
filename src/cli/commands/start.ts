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
    .option('--log-level <level>', LOG_LEVEL_OPTION_DESCRIPTION)
    .option('--chrome-prefs <json>', CHROME_PREFS_OPTION_DESCRIPTION)
    .option('--chrome-prefs-file <path>', CHROME_PREFS_FILE_OPTION_DESCRIPTION)
    .option('--chrome-flags <flags...>', CHROME_FLAGS_OPTION_DESCRIPTION)
    .option('--connection-poll-interval <ms>', CONNECTION_POLL_INTERVAL_OPTION_DESCRIPTION)
    .option('--max-connection-retries <count>', MAX_CONNECTION_RETRIES_OPTION_DESCRIPTION)
    .option('--port-strict', PORT_STRICT_OPTION_DESCRIPTION);
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
} {
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
  };
}

/**
 * Common action handler for collector commands
 *
 * @param url - Target URL to collect telemetry from
 * @param options - Parsed command-line options from Commander
 * @param collectors - Array of collector types to activate
 * @returns Promise that resolves when session completes or is stopped
 */
async function collectorAction(
  url: string,
  options: CollectorOptions,
  collectors: CollectorType[]
): Promise<void> {
  const sessionOptions = buildSessionOptions(options);
  await startSession(url, sessionOptions, collectors);
}

/**
 * Register all start/collector commands
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerStartCommands(program: Command): void {
  // IMPORTANT: Register subcommands FIRST, before default command
  // This prevents Commander.js from treating subcommand names as arguments

  // DOM only
  applyCollectorOptions(
    program.command('dom').description('Collect DOM only').argument('<url>', 'Target URL')
  ).action(async (url: string, options: CollectorOptions) => {
    await collectorAction(url, options, ['dom']);
  });

  // Network only
  applyCollectorOptions(
    program
      .command('network')
      .description('Collect network requests only')
      .argument('<url>', 'Target URL')
  ).action(async (url: string, options: CollectorOptions) => {
    await collectorAction(url, options, ['network']);
  });

  // Console only
  applyCollectorOptions(
    program
      .command('console')
      .description('Collect console logs only')
      .argument('<url>', 'Target URL')
  ).action(async (url: string, options: CollectorOptions) => {
    await collectorAction(url, options, ['console']);
  });

  // Default command: collect all data
  // MUST be registered AFTER subcommands
  applyCollectorOptions(
    program.argument('<url>', 'Target URL (example.com or localhost:3000)')
  ).action(async (url: string, options: CollectorOptions) => {
    await collectorAction(url, options, ['dom', 'network', 'console']);
  });
}
